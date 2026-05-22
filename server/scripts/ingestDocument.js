'use strict';

// =============================================================================
// server/scripts/ingestDocument.js
//
// LIB-2: standalone large-document ingestion with chunking.
//
// Splits a large reference document (for example the full Local Government
// Regulation 2012) into chunks, embeds each chunk, and inserts ONE
// library_documents row per chunk. Every chunk shares a single
// parent_document_id so the pieces can be grouped in the UI later.
//
// HOW TO RUN (from the server/ folder):
//   node scripts/ingestDocument.js "C:\path\to\file.pdf" --title "Document Title"
//
// FLAGS (all optional):
//   --title "..."         Document title (default: the file name)
//   --category "..."      Library category (default: Legislation)
//   --domain "..."        Domain (default: General)
//   --jurisdiction "..."  Jurisdiction (default: Queensland)
//   --description "..."   Short description (default: none)
//   --source-url "..."    Source URL (default: none)
//
// NOTES:
//   - This creates ADMIN / global rows (user_id stays null,
//     is_admin_managed true, default_enabled true), so every user can
//     retrieve the content.
//   - No new npm packages are required: it reuses mammoth, pdf2json,
//     @supabase/supabase-js and openai, which the server already installs.
//   - Supported file types: .pdf, .docx, and plain text (.txt, .md, .csv).
// =============================================================================

const fs = require('fs');
const path = require('path');

// --- Load environment variables without depending on the dotenv package -----
// Reads server/.env (KEY=VALUE per line) and fills any keys not already set in
// the shell. Safe to run where env vars are already present (it just skips).
(function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
})();

const crypto = require('crypto');
const mammoth = require('mammoth');
const PDFParser = require('pdf2json');

const supabase = require('../lib/supabase');
const { chunkAndEmbed } = require('../lib/chunkAndEmbed');

// --- PDF extraction (same approach as routes/library.js) --------------------
function extractPdf(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, 1);
    pdfParser.on('pdfParser_dataError', err => reject(new Error(err.parserError)));
    pdfParser.on('pdfParser_dataReady', () => {
      try { resolve(pdfParser.getRawTextContent()); }
      catch (e) { reject(e); }
    });
    pdfParser.parseBuffer(buffer);
  });
}

async function extractText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return extractPdf(buffer);
  }
  if (lower.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  // Plain text fallback: .txt, .md, .csv, etc.
  return buffer.toString('utf-8');
}

// --- Tiny argument parser (positional path + --flag value) ------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function pickString(value, fallback) {
  return (typeof value === 'string' && value.trim()) ? value.trim() : fallback;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args._[0];

  if (!filePath) {
    console.error('Usage:');
    console.error('  node scripts/ingestDocument.js "C:\\path\\to\\file.pdf" --title "Document Title" [--category ...] [--domain ...] [--jurisdiction ...]');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error('File not found: ' + filePath);
    process.exit(1);
  }

  const fileName = path.basename(filePath).replace(/\.[^.]+$/, '');
  const title = pickString(args.title, fileName);
  const category = pickString(args.category, 'Legislation');
  const domain = pickString(args.domain, 'General');
  const jurisdiction = pickString(args.jurisdiction, 'Queensland');
  const description = pickString(args.description, null);
  const sourceUrl = pickString(args['source-url'], null);

  console.log('Extracting text from: ' + filePath);
  const text = await extractText(filePath);
  if (!text || text.trim().length < 20) {
    console.error('Could not extract usable text (the file may be empty or image-only).');
    process.exit(1);
  }
  console.log('Extracted ' + text.length.toLocaleString() + ' characters.');

  console.log('Chunking and embedding (this can take a minute or two for large documents)...');
  const results = await chunkAndEmbed(text, (done, total) => {
    process.stdout.write('\r  Embedded ' + done + ' of ' + total + ' chunks   ');
  });
  process.stdout.write('\n');

  const total = results.length;
  if (total === 0) {
    console.error('No chunks were produced. Aborting.');
    process.exit(1);
  }

  const parentDocumentId = crypto.randomUUID();

  const rows = results.map(r => ({
    title: total > 1 ? (title + ' (part ' + (r.index + 1) + ' of ' + total + ')') : title,
    category,
    domain,
    jurisdiction,
    description,
    source_url: sourceUrl,
    content: r.content.slice(0, 50000), // safety net only; chunks are far smaller
    embedding: r.embedding,
    is_admin_managed: true,
    default_enabled: true,
    parent_document_id: parentDocumentId,
  }));

  console.log('Inserting ' + total + ' chunk rows into library_documents...');
  const BATCH = 25;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('library_documents').insert(batch);
    if (error) {
      console.error('\nInsert failed on batch starting at row ' + i + ': ' + error.message);
      process.exit(1);
    }
    inserted += batch.length;
    process.stdout.write('\r  Inserted ' + inserted + ' of ' + total + ' rows   ');
  }
  process.stdout.write('\n');

  console.log('');
  console.log('Done. Ingested "' + title + '" as ' + total + ' chunks.');
  console.log('parent_document_id: ' + parentDocumentId);
  console.log('');
  console.log('Next: test retrieval in AHC, then delete any old oversized single row for this document.');
}

main().catch(err => {
  console.error('Ingestion error:', err);
  process.exit(1);
});
