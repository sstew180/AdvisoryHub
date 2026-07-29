'use strict';

// =============================================================================
// server/scripts/ingestDocument.js
//
// LIB-2:  standalone large-document ingestion with chunking.
// LIB-6b: project-scoped ingestion for demo contract packs.
//
// Splits a large document into chunks, embeds each chunk, and inserts ONE
// library_documents row per chunk. Every chunk of a document shares a single
// parent_document_id so the pieces can be grouped, and deleted, together.
//
// TWO MODES
// ---------
// 1. ADMIN / GLOBAL (default, unchanged behaviour)
//    No --project-id flag. Rows are written with is_admin_managed true and
//    default_enabled true, so every user can retrieve the content.
//
// 2. PROJECT-ONLY (new)
//    One or more --project-id flags. Rows are written with user_id null,
//    default_enabled false, is_admin_managed false and project_id set, which
//    is the PROJECT-ONLY scope the retrieval layer expects. This is the
//    correct path for demo contract packs. Do NOT use the in-app upload for
//    these: it stamps the logged-in user's id and sets default_enabled true.
//
//    When several --project-id flags are given, each chunk is embedded ONCE
//    and inserted once per project id, reusing the same vector. Retrieval
//    matches on an exact project_id and does not walk the parent/child
//    hierarchy, so a document must be attached to every project you intend to
//    ask questions from, including sub-projects.
//
// HOW TO RUN (from the server/ folder)
// ------------------------------------
//   Single file, admin/global (unchanged):
//     node scripts/ingestDocument.js "C:\path\to\file.pdf" --title "Document Title"
//
//   Whole folder, scoped to one project and its three sub-projects:
//     node scripts/ingestDocument.js "C:\path\to\folder" ^
//       --project-id df095213-1674-4ef9-93ba-fce7371fc013 ^
//       --project-id 1b7d54de-63a8-4d62-856d-656e63d02a3d ^
//       --category "Contract" --domain "Contract Management"
//
// FLAGS (all optional)
// --------------------
//   --project-id "..."    Repeatable. Switches the run to PROJECT-ONLY scope.
//   --title "..."         Title. Ignored in folder mode (see title rules).
//   --category "..."      Default: Contract in project mode, Legislation otherwise
//   --domain "..."        Default: Contract Management in project mode, General otherwise
//   --jurisdiction "..."  Default: Queensland
//   --description "..."   Default: none
//   --source-url "..."    Default: none
//   --dry-run             Extract, chunk and report, but insert nothing.
//
// TITLE RULES
// -----------
//   --title wins when given for a single file. Otherwise, for .md files the
//   first markdown H1 ("# Something") is used, which gives clean citations.
//   Failing that, the file name is cleaned up (underscores to spaces).
//
// NOTES
// -----
//   - No new npm packages: reuses mammoth, pdf2json, @supabase/supabase-js
//     and openai, which the server already installs.
//   - Supported file types: .pdf, .docx, and plain text (.txt, .md, .csv).
//   - Image-only (scanned) PDFs yield no text and are reported as skipped.
//     Those need OCR before they can be ingested.
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

const SUPPORTED = ['.pdf', '.docx', '.txt', '.md', '.csv'];

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

// --- Tiny argument parser ---------------------------------------------------
// Positional path plus --flag value. A flag repeated more than once collects
// into an array, which is how multiple --project-id values are captured.
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      let value;
      if (next === undefined || next.startsWith('--')) {
        value = true;
      } else {
        value = next;
        i++;
      }
      if (key in args) {
        if (Array.isArray(args[key])) args[key].push(value);
        else args[key] = [args[key], value];
      } else {
        args[key] = value;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function pickString(value, fallback) {
  if (Array.isArray(value)) value = value[value.length - 1];
  return (typeof value === 'string' && value.trim()) ? value.trim() : fallback;
}

function toArray(value) {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string' && v.trim());
  return (typeof value === 'string' && value.trim()) ? [value.trim()] : [];
}

// --- Title derivation -------------------------------------------------------
// For markdown, prefer the first H1 line: it is already a clean human title
// and it is what shows in citations. Otherwise tidy up the file name.
function deriveTitle(filePath, text) {
  if (filePath.toLowerCase().endsWith('.md') && typeof text === 'string') {
    const lines = text.split(/\r?\n/);
    for (const line of lines.slice(0, 20)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('# ')) return trimmed.slice(2).trim();
      break;
    }
  }
  const base = path.basename(filePath).replace(/\.[^.]+$/, '');
  return base.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// --- Ingest a single file ---------------------------------------------------
async function ingestFile(filePath, options) {
  const {
    projectIds, category, domain, jurisdiction,
    description, sourceUrl, explicitTitle, dryRun,
  } = options;

  console.log('');
  console.log('File: ' + path.basename(filePath));

  const text = await extractText(filePath);
  if (!text || text.trim().length < 20) {
    console.log('  SKIPPED: no usable text extracted (likely an image-only scan needing OCR).');
    return { skipped: true, chunks: 0, rows: 0 };
  }

  const title = explicitTitle || deriveTitle(filePath, text);
  console.log('  Title: ' + title);
  console.log('  Extracted ' + text.length.toLocaleString() + ' characters.');

  console.log('  Chunking and embedding...');
  const results = await chunkAndEmbed(text, (done, total) => {
    process.stdout.write('\r    Embedded ' + done + ' of ' + total + ' chunks   ');
  });
  process.stdout.write('\n');

  const total = results.length;
  if (total === 0) {
    console.log('  SKIPPED: no chunks produced.');
    return { skipped: true, chunks: 0, rows: 0 };
  }

  // One parent_document_id per document, shared across every project copy, so
  // the whole document can be removed with a single delete on that id.
  const parentDocumentId = crypto.randomUUID();

  const baseRow = r => ({
    title: total > 1 ? (title + ' (part ' + (r.index + 1) + ' of ' + total + ')') : title,
    category,
    domain,
    jurisdiction,
    description,
    source_url: sourceUrl,
    content: r.content.slice(0, 50000), // safety net only; chunks are far smaller
    embedding: r.embedding,
    parent_document_id: parentDocumentId,
  });

  let rows = [];
  if (projectIds.length > 0) {
    // PROJECT-ONLY scope. Embed once, insert once per project id.
    for (const projectId of projectIds) {
      for (const r of results) {
        rows.push(Object.assign(baseRow(r), {
          user_id: null,
          project_id: projectId,
          is_admin_managed: false,
          default_enabled: false,
        }));
      }
    }
  } else {
    // ADMIN / GLOBAL scope, unchanged from the original script.
    rows = results.map(r => Object.assign(baseRow(r), {
      is_admin_managed: true,
      default_enabled: true,
    }));
  }

  console.log('  ' + total + ' chunks -> ' + rows.length + ' rows. parent_document_id: ' + parentDocumentId);

  if (dryRun) {
    console.log('  DRY RUN: nothing inserted.');
    return { skipped: false, chunks: total, rows: rows.length, dryRun: true };
  }

  const BATCH = 25;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('library_documents').insert(batch);
    if (error) {
      console.error('\n  Insert failed on batch starting at row ' + i + ': ' + error.message);
      process.exit(1);
    }
    inserted += batch.length;
    process.stdout.write('\r    Inserted ' + inserted + ' of ' + rows.length + ' rows   ');
  }
  process.stdout.write('\n');

  return { skipped: false, chunks: total, rows: rows.length, parentDocumentId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args._[0];

  if (!inputPath) {
    console.error('Usage:');
    console.error('  node scripts/ingestDocument.js "C:\\path\\to\\file-or-folder" [flags]');
    console.error('');
    console.error('Flags:');
    console.error('  --project-id "..."   Repeatable. Switches to PROJECT-ONLY scope.');
    console.error('  --title "..."        Single-file mode only.');
    console.error('  --category "..."     --domain "..."   --jurisdiction "..."');
    console.error('  --description "..."  --source-url "..."');
    console.error('  --dry-run            Extract and report, insert nothing.');
    process.exit(1);
  }
  if (!fs.existsSync(inputPath)) {
    console.error('Path not found: ' + inputPath);
    process.exit(1);
  }

  const projectIds = toArray(args['project-id']);
  const isProjectMode = projectIds.length > 0;
  const dryRun = args['dry-run'] === true;

  const category = pickString(args.category, isProjectMode ? 'Contract' : 'Legislation');
  const domain = pickString(args.domain, isProjectMode ? 'Contract Management' : 'General');
  const jurisdiction = pickString(args.jurisdiction, 'Queensland');
  const description = pickString(args.description, null);
  const sourceUrl = pickString(args['source-url'], null);

  const stat = fs.statSync(inputPath);
  const isFolder = stat.isDirectory();

  let files = [];
  if (isFolder) {
    files = fs.readdirSync(inputPath)
      .filter(name => SUPPORTED.includes(path.extname(name).toLowerCase()))
      .sort()
      .map(name => path.join(inputPath, name));
    if (files.length === 0) {
      console.error('No supported files found in: ' + inputPath);
      console.error('Supported extensions: ' + SUPPORTED.join(', '));
      process.exit(1);
    }
  } else {
    files = [inputPath];
  }

  console.log('=========================================================');
  console.log('Scope:        ' + (isProjectMode ? 'PROJECT-ONLY' : 'ADMIN / GLOBAL'));
  if (isProjectMode) {
    console.log('Project ids:  ' + projectIds.length);
    projectIds.forEach(id => console.log('              ' + id));
  }
  console.log('Category:     ' + category);
  console.log('Domain:       ' + domain);
  console.log('Jurisdiction: ' + jurisdiction);
  console.log('Files:        ' + files.length);
  if (dryRun) console.log('DRY RUN:      no rows will be inserted');
  console.log('=========================================================');

  const explicitTitle = isFolder ? null : pickString(args.title, null);

  const summary = [];
  for (const filePath of files) {
    const result = await ingestFile(filePath, {
      projectIds, category, domain, jurisdiction,
      description, sourceUrl, explicitTitle, dryRun,
    });
    summary.push({ file: path.basename(filePath), ...result });
  }

  const ingested = summary.filter(s => !s.skipped);
  const skipped = summary.filter(s => s.skipped);
  const totalChunks = ingested.reduce((n, s) => n + s.chunks, 0);
  const totalRows = ingested.reduce((n, s) => n + s.rows, 0);

  console.log('');
  console.log('=========================================================');
  console.log('Done. ' + ingested.length + ' of ' + files.length + ' files ingested.');
  console.log('Chunks: ' + totalChunks + '   Rows ' + (dryRun ? 'that would be written' : 'written') + ': ' + totalRows);
  if (skipped.length > 0) {
    console.log('');
    console.log('Skipped (no extractable text, needs OCR):');
    skipped.forEach(s => console.log('  ' + s.file));
  }
  console.log('=========================================================');
  console.log('');
  if (isProjectMode && !dryRun) {
    console.log('Verify the scope in Supabase:');
    console.log("  select project_id, count(*) from library_documents");
    console.log("  where project_id in ('" + projectIds.join("','") + "')");
    console.log("  group by project_id;");
    console.log('');
    console.log('Then test retrieval in AHC from each project.');
  }
}

main().catch(err => {
  console.error('Ingestion error:', err);
  process.exit(1);
});
