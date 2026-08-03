'use strict';

// =============================================================================
// server/lib/chunkAndEmbed.js
//
// LIB-2:  shared chunking + embedding helper.
// LIB-10: configurable chunk sizing and overlap.
//
// Why this exists:
//   The library embedding (lib/embed.js) truncates every input to the first
//   8,000 characters. A large reference document (for example the full Local
//   Government Regulation 2012) therefore gets a searchable "fingerprint" that
//   represents only its opening pages, so deep content is never matched.
//
//   The fix is to split a large document into many smaller pieces and embed
//   each piece on its own. Each piece becomes its own library_documents row,
//   so any part of the document can be retrieved.
//
// Why sizing is now configurable (LIB-10):
//   An embedding is a single vector for a whole chunk, so it represents that
//   chunk's DOMINANT subject matter. At 6,000 characters this works well for
//   legislation and guidance, where a passage stays on one topic for pages.
//   It works badly for contracts, where a short decisive clause can sit inside
//   pages of unrelated operational text: the clause contributes only a small
//   fraction of the vector and the chunk never ranks for a query about it.
//
//   Observed case: Part B clause 5.11.4 (rise and fall, fuel and CPI) occupied
//   roughly 700 characters of a 6,100-character chunk otherwise made up of
//   payment claim procedures, weighbridge dockets and site access rules. A
//   direct question about fuel price adjustment did not retrieve it.
//
//   Smaller chunks give clause-level content its own vector. Overlap stops a
//   clause that straddles a boundary from being lost to both sides.
//
// What this module does:
//   splitIntoChunks(text, options)  -> array of text chunks
//   chunkAndEmbed(text, cb, options) -> array of { index, content, embedding }
//
// This module does NOT touch the database. The ingestion script
// (scripts/ingestDocument.js) is responsible for inserting rows.
// =============================================================================

const { embed } = require('./embed');

// Default chunk sizing, measured in characters. These are the ORIGINAL values,
// so any caller that passes no options behaves exactly as it did before.
//   TARGET_CHARS  soft target. We flush a chunk once it passes this size.
//   MAX_CHARS     hard ceiling. Kept below embed()'s 8,000-char limit so a
//                 chunk is NEVER silently truncated when embedded. This is the
//                 whole point of the fix.
//   MIN_CHARS     a heading is only allowed to start a fresh chunk once the
//                 current chunk already holds at least this much content. This
//                 stops tiny one-line chunks forming at every heading.
//   OVERLAP_CHARS characters of the previous chunk repeated at the start of
//                 the next. Zero by default, preserving original behaviour.
const TARGET_CHARS = 6000;
const MAX_CHARS = 7500;
const MIN_CHARS = 1000;
const OVERLAP_CHARS = 0;

// Absolute ceiling. embed() truncates at 8,000 characters, so a chunk must
// never be allowed above this regardless of what a caller asks for.
const EMBED_SAFE_MAX = 7500;

// Heading patterns common in Queensland legislation, e.g.
//   "Chapter 6", "Part 2", "Division 3", "Subdivision 1", "Schedule 4".
const HEADING_RE = /^(chapter|part|division|subdivision|schedule)\b/i;

// A numbered section or clause heading, e.g. "207 Disposing of...", "207A ...",
// "237.", "5.11.4", "20.3". Contract clause numbering is covered by the
// leading-digit form.
const SECTION_RE = /^\d{1,4}[A-Za-z]?[\s.)\u2014-]/;

/**
 * Resolve caller options against the defaults, applying safety guards.
 *
 * Only targetChars need be supplied: the other three are derived from it in
 * sensible proportion unless explicitly overridden. This keeps the common case
 * to a single number.
 *
 * @param {object} [options]
 * @param {number} [options.targetChars]
 * @param {number} [options.maxChars]
 * @param {number} [options.minChars]
 * @param {number} [options.overlapChars]
 * @returns {{targetChars:number, maxChars:number, minChars:number, overlapChars:number}}
 */
function resolveOptions(options) {
  // No options at all: return the original constants exactly, so every
  // existing caller is bit-for-bit unchanged.
  if (!options || Object.keys(options).length === 0) {
    return {
      targetChars: TARGET_CHARS,
      maxChars: MAX_CHARS,
      minChars: MIN_CHARS,
      overlapChars: OVERLAP_CHARS,
    };
  }

  const o = options;
  const target = Number.isFinite(o.targetChars) && o.targetChars > 0
    ? Math.floor(o.targetChars)
    : TARGET_CHARS;

  // Derive the rest from the target unless given. The ratios mirror the
  // original defaults (max 1.25x, min 0.17x) but with a floor so very small
  // targets still behave.
  let max = Number.isFinite(o.maxChars) && o.maxChars > 0
    ? Math.floor(o.maxChars)
    : Math.max(Math.round(target * 1.25), target + 200);

  let min = Number.isFinite(o.minChars) && o.minChars >= 0
    ? Math.floor(o.minChars)
    : Math.max(Math.round(target * 0.17), 120);

  let overlap = Number.isFinite(o.overlapChars) && o.overlapChars >= 0
    ? Math.floor(o.overlapChars)
    : (options && Object.prototype.hasOwnProperty.call(options, 'targetChars')
        ? Math.round(target * 0.12)   // caller chose a size: give sensible overlap
        : OVERLAP_CHARS);             // no options at all: original behaviour

  // Guards.
  // 1. Never exceed the embedding window.
  max = Math.min(max, EMBED_SAFE_MAX);
  // 2. The hard cap must sit above the soft target.
  if (max <= target) max = Math.min(target + 200, EMBED_SAFE_MAX);
  // 3. Overlap must stay well below the target or chunks stop advancing.
  overlap = Math.min(overlap, Math.floor(target / 3));
  // 4. The boundary floor must sit below the target.
  if (min >= target) min = Math.floor(target / 2);

  return { targetChars: target, maxChars: max, minChars: min, overlapChars: overlap };
}

/**
 * Take the trailing slice of a chunk to seed the next one, so content that
 * straddles a boundary is retrievable from both sides. Cuts on a line break
 * where possible so the overlap does not begin mid-sentence.
 *
 * @param {string} chunk
 * @param {number} overlapChars
 * @returns {string}
 */
function trailingOverlap(chunk, overlapChars) {
  if (overlapChars <= 0 || !chunk) return '';
  if (chunk.length <= overlapChars) return chunk;

  const tail = chunk.slice(chunk.length - overlapChars);
  const breakAt = tail.indexOf('\n');
  // Prefer starting the overlap at a line boundary, provided that does not
  // throw away most of it.
  if (breakAt > -1 && breakAt < overlapChars * 0.5) {
    return tail.slice(breakAt + 1).trim();
  }
  return tail.trim();
}

/**
 * Split raw extracted text into embeddable chunks.
 *
 * @param {string} text       The full extracted document text.
 * @param {object} [options]  See resolveOptions.
 * @returns {string[]}        Array of chunk strings.
 */
function splitIntoChunks(text, options) {
  const { targetChars, maxChars, minChars, overlapChars } = resolveOptions(options);

  const normalised = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Prefer splitting on blank lines (paragraph boundaries). Some extractors
  // (notably pdf2json) emit single newlines only, so if blank-line splitting
  // produces one giant block, fall back to single-newline splitting.
  let blocks = normalised.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  if (blocks.length <= 1 && normalised.length > maxChars) {
    blocks = normalised.split(/\n/).map(b => b.trim()).filter(Boolean);
  }

  // A block bigger than the target would defeat small-chunk sizing on its own,
  // so break oversized blocks down on single newlines before assembling.
  if (blocks.some(b => b.length > targetChars)) {
    const expanded = [];
    for (const block of blocks) {
      if (block.length > targetChars && block.includes('\n')) {
        block.split(/\n/).map(b => b.trim()).filter(Boolean).forEach(b => expanded.push(b));
      } else {
        expanded.push(block);
      }
    }
    blocks = expanded;
  }

  const chunks = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
      current = trailingOverlap(trimmed, overlapChars);
    } else {
      current = '';
    }
  };

  for (const block of blocks) {
    const firstLine = block.split('\n')[0].trim();
    const isBoundary = HEADING_RE.test(firstLine) || SECTION_RE.test(firstLine);

    // Start a fresh chunk at a heading/section boundary, but only once the
    // current chunk already has enough content to stand on its own.
    if (isBoundary && current.length >= minChars) {
      flush();
    }

    // A single block bigger than the hard cap (rare) is split by characters,
    // advancing by a stride that leaves the requested overlap between pieces.
    if (block.length > maxChars) {
      flush();
      current = '';
      const stride = Math.max(maxChars - overlapChars, Math.floor(maxChars / 2));
      for (let i = 0; i < block.length; i += stride) {
        const piece = block.slice(i, i + maxChars).trim();
        if (piece) chunks.push(piece);
      }
      continue;
    }

    // If adding this block would push us over the hard cap, flush first.
    if (current.length > 0 && current.length + block.length + 2 > maxChars) {
      flush();
    }

    current = current ? current + '\n\n' + block : block;

    // Reached the soft target, flush so chunks stay close to targetChars.
    if (current.length >= targetChars) {
      flush();
    }
  }

  // Final flush must not seed another overlap chunk, so clear afterwards.
  const tail = current.trim();
  if (tail) {
    // Guard against the last chunk being nothing but repeated overlap text.
    const last = chunks[chunks.length - 1];
    if (!last || !last.endsWith(tail)) chunks.push(tail);
  }

  return chunks;
}

/**
 * Split text into chunks and embed each chunk.
 *
 * @param {string} text                 The full extracted document text.
 * @param {(done:number,total:number)=>void} [onProgress]  Optional progress callback.
 * @param {object} [options]            See resolveOptions.
 * @returns {Promise<Array<{index:number, content:string, embedding:number[]}>>}
 */
async function chunkAndEmbed(text, onProgress, options) {
  const chunks = splitIntoChunks(text, options);
  const results = [];

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embed(chunks[i]);
    results.push({ index: i, content: chunks[i], embedding });
    if (typeof onProgress === 'function') onProgress(i + 1, chunks.length);
  }

  return results;
}

module.exports = {
  chunkAndEmbed,
  splitIntoChunks,
  resolveOptions,
  TARGET_CHARS,
  MAX_CHARS,
  MIN_CHARS,
  OVERLAP_CHARS,
};