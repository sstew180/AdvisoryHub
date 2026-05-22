'use strict';

// =============================================================================
// server/lib/chunkAndEmbed.js
//
// LIB-2: shared chunking + embedding helper.
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
// What this module does:
//   splitIntoChunks(text)  -> array of text chunks, sized to stay UNDER the
//                             8,000-char embedding window so nothing is
//                             truncated, preferring legislation section and
//                             chapter boundaries where they exist.
//   chunkAndEmbed(text, cb) -> array of { index, content, embedding }, calling
//                             embed() once per chunk. Optional progress
//                             callback cb(done, total).
//
// This module does NOT touch the database. The ingestion script
// (scripts/ingestDocument.js) is responsible for inserting rows.
// =============================================================================

const { embed } = require('./embed');

// Chunk sizing, measured in characters.
//   TARGET_CHARS  soft target. We flush a chunk once it passes this size.
//   MAX_CHARS     hard ceiling. Kept below embed()'s 8,000-char limit so a
//                 chunk is NEVER silently truncated when embedded. This is the
//                 whole point of the fix.
//   MIN_CHARS     a heading is only allowed to start a fresh chunk once the
//                 current chunk already holds at least this much content. This
//                 stops tiny one-line chunks forming at every heading.
const TARGET_CHARS = 6000;
const MAX_CHARS = 7500;
const MIN_CHARS = 1000;

// Heading patterns common in Queensland legislation, e.g.
//   "Chapter 6", "Part 2", "Division 3", "Subdivision 1", "Schedule 4".
const HEADING_RE = /^(chapter|part|division|subdivision|schedule)\b/i;

// A numbered section heading, e.g. "207 Disposing of...", "207A ...", "237.".
const SECTION_RE = /^\d{1,4}[A-Za-z]?[\s.)\u2014-]/;

/**
 * Split raw extracted text into embeddable chunks.
 *
 * @param {string} text  The full extracted document text.
 * @returns {string[]}   Array of chunk strings.
 */
function splitIntoChunks(text) {
  const normalised = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Prefer splitting on blank lines (paragraph boundaries). Some extractors
  // (notably pdf2json) emit single newlines only, so if blank-line splitting
  // produces one giant block, fall back to single-newline splitting.
  let blocks = normalised.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  if (blocks.length <= 1 && normalised.length > MAX_CHARS) {
    blocks = normalised.split(/\n/).map(b => b.trim()).filter(Boolean);
  }

  const chunks = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  for (const block of blocks) {
    const firstLine = block.split('\n')[0].trim();
    const isBoundary = HEADING_RE.test(firstLine) || SECTION_RE.test(firstLine);

    // Start a fresh chunk at a heading/section boundary, but only once the
    // current chunk already has enough content to stand on its own.
    if (isBoundary && current.length >= MIN_CHARS) {
      flush();
    }

    // A single block bigger than the hard cap (rare) is split by characters.
    if (block.length > MAX_CHARS) {
      flush();
      for (let i = 0; i < block.length; i += MAX_CHARS) {
        const piece = block.slice(i, i + MAX_CHARS).trim();
        if (piece) chunks.push(piece);
      }
      continue;
    }

    // If adding this block would push us over the hard cap, flush first.
    if (current.length > 0 && current.length + block.length + 2 > MAX_CHARS) {
      flush();
    }

    current = current ? current + '\n\n' + block : block;

    // Reached the soft target, flush so chunks stay close to TARGET_CHARS.
    if (current.length >= TARGET_CHARS) {
      flush();
    }
  }

  flush();
  return chunks;
}

/**
 * Split text into chunks and embed each chunk.
 *
 * @param {string} text                 The full extracted document text.
 * @param {(done:number,total:number)=>void} [onProgress]  Optional progress callback.
 * @returns {Promise<Array<{index:number, content:string, embedding:number[]}>>}
 */
async function chunkAndEmbed(text, onProgress) {
  const chunks = splitIntoChunks(text);
  const results = [];

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embed(chunks[i]);
    results.push({ index: i, content: chunks[i], embedding });
    if (typeof onProgress === 'function') onProgress(i + 1, chunks.length);
  }

  return results;
}

module.exports = { chunkAndEmbed, splitIntoChunks, TARGET_CHARS, MAX_CHARS, MIN_CHARS };
