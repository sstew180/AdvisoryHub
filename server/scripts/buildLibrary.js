/**
 * AdvisoryHub Library Build Script
 * 
 * Walks the library folder tree, extracts text from each file,
 * generates embeddings via OpenAI, and inserts into Supabase library_documents.
 * 
 * Skips documents with a matching title already in the database.
 * 
 * Usage:
 *   node server/scripts/buildLibrary.js
 *   node server/scripts/buildLibrary.js --dry-run
 *   node server/scripts/buildLibrary.js --folder "Risk & Audit"
 * 
 * Requirements:
 *   npm install @supabase/supabase-js openai pdf2json mammoth dotenv
 * 
 * Environment variables (from server/.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

// ─── Config ──────────────────────────────────────────────────────────────────

const LIBRARY_ROOT = process.env.LIBRARY_PATH || 
  'C:\\Users\\scott\\OneDrive\\AI.app\\advisoryhub\\library';

const DRY_RUN = process.argv.includes('--dry-run');
const FOLDER_FILTER = (() => {
  const idx = process.argv.indexOf('--folder');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.md', '.txt'];

// Embedding batch delay -- avoids OpenAI rate limits
const EMBED_DELAY_MS = 500;

// Max content length sent to embedding model (chars)
const MAX_EMBED_CHARS = 8000;

// Max content stored in Supabase (chars)
const MAX_CONTENT_CHARS = 50000;

// ─── Clients ─────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Path metadata derivation ─────────────────────────────────────────────────
/**
 * Derives library metadata from the file's path relative to LIBRARY_ROOT.
 * 
 * Path patterns:
 *   General/Skills/skill-xxx.md          → domain=General, tier=base, category=Skills
 *   General/Templates/xxx.md             → domain=General, tier=base, category=Templates
 *   General/Organisation/xxx.pdf         → domain=General, tier=base, category=Organisation
 *   Risk & Audit/Base/Skills/xxx.md      → domain=Risk & Audit, tier=base, category=Skills
 *   Risk & Audit/Base/Frameworks/xxx.pdf → domain=Risk & Audit, tier=base, category=Frameworks
 *   Risk & Audit/Base/Legislation/xxx.md → domain=Risk & Audit, tier=base, category=Legislation
 *   Risk & Audit/Enhanced/...            → domain=Risk & Audit, tier=enhanced, ...
 *   Contract Management/Base/...         → domain=Contract Management, tier=base, ...
 *   Contract Management/Enhanced/...     → domain=Contract Management, tier=enhanced, ...
 *   Professional Practice/Communication/ → domain=Professional Practice, tier=base, category=Communication
 *   Professional Practice/Consulting & Frameworks/ → domain=Professional Practice, tier=enhanced, category=Consulting Frameworks
 */
function deriveMetadata(filePath) {
  const rel = path.relative(LIBRARY_ROOT, filePath);
  const parts = rel.split(path.sep);

  // Default metadata
  let domain = 'General';
  let tier = 'base';
  let category = 'General';
  let jurisdiction = 'Queensland';

  if (parts.length === 0) return { domain, tier, category, jurisdiction };

  const top = parts[0]; // e.g. "Risk & Audit", "General", "Professional Practice"

  // ── General ──────────────────────────────────────────────────────────────
  if (top === 'General') {
    domain = 'General';
    tier = 'base';
    category = parts[1] || 'General'; // Skills, Templates, Organisation
    return { domain, tier, category, jurisdiction };
  }

  // ── Risk & Audit ──────────────────────────────────────────────────────────
  if (top === 'Risk & Audit') {
    domain = 'Risk & Audit';
    tier = (parts[1] || '').toLowerCase() === 'enhanced' ? 'enhanced' : 'base';
    category = parts[2] || 'Frameworks'; // Skills, Frameworks, Legislation
    return { domain, tier, category, jurisdiction };
  }

  // ── Contract Management ───────────────────────────────────────────────────
  if (top === 'Contract Management') {
    domain = 'Contract Management';
    tier = (parts[1] || '').toLowerCase() === 'enhanced' ? 'enhanced' : 'base';
    category = parts[2] || 'Frameworks';
    return { domain, tier, category, jurisdiction };
  }

  // ── Professional Practice ─────────────────────────────────────────────────
  if (top === 'Professional Practice') {
    domain = 'Professional Practice';
    tier = 'base';
    const subfolder = parts[1] || 'General';

    // Consulting Frameworks is enhanced -- it requires specialist knowledge
    if (subfolder === 'Consulting & Frameworks') {
      tier = 'enhanced';
      category = 'Consulting Frameworks';
    } else if (subfolder === 'Legal & Compliance') {
      tier = 'enhanced';
      category = subfolder;
    } else if (subfolder === 'Management & Leadership') {
      tier = 'enhanced';
      category = subfolder;
    } else {
      category = subfolder;
    }

    return { domain, tier, category, jurisdiction };
  }

  // ── Finance ───────────────────────────────────────────────────────────────
  if (top === 'Finance') {
    domain = 'Finance';
    tier = (parts[1] || '').toLowerCase() === 'enhanced' ? 'enhanced' : 'base';
    category = parts[2] || 'Skills';
    return { domain, tier, category, jurisdiction };
  }

  // ── HR & People ───────────────────────────────────────────────────────────
  if (top === 'HR & People') {
    domain = 'HR & People';
    tier = (parts[1] || '').toLowerCase() === 'enhanced' ? 'enhanced' : 'base';
    category = parts[2] || 'Skills';
    return { domain, tier, category, jurisdiction };
  }

  return { domain, tier, category, jurisdiction };
}

// ─── Title derivation ─────────────────────────────────────────────────────────
/**
 * Derives a clean title from filename.
 * skill-risk-register.md → skill-risk-register
 * QAO-Better-Practice.pdf → QAO-Better-Practice
 */
function deriveTitle(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

// ─── Text extraction ──────────────────────────────────────────────────────────

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.md' || ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.pdf') {
    return extractPdf(filePath);
  }

  if (ext === '.docx') {
    return extractDocx(filePath);
  }

  return null;
}

async function extractPdf(filePath) {
  return new Promise((resolve, reject) => {
    const PDFParser = require('pdf2json');
    const pdfParser = new PDFParser(null, 1);

    pdfParser.on('pdfParser_dataError', (err) => {
      console.warn(`  ⚠ PDF parse error for ${path.basename(filePath)}: ${err.parserError}`);
      resolve(''); // Don't fail the whole run for one bad PDF
    });

    pdfParser.on('pdfParser_dataReady', () => {
      try {
        const text = pdfParser.getRawTextContent();
        resolve(text);
      } catch (e) {
        console.warn(`  ⚠ PDF text extraction failed for ${path.basename(filePath)}: ${e.message}`);
        resolve('');
      }
    });

    pdfParser.loadPDF(filePath);
  });
}

async function extractDocx(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

// ─── Embedding ────────────────────────────────────────────────────────────────

async function embed(text) {
  const input = text.slice(0, MAX_EMBED_CHARS);
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input,
  });
  return response.data[0].embedding;
}

// ─── File walker ──────────────────────────────────────────────────────────────

function walkDir(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, fileList);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

// ─── Duplicate check ──────────────────────────────────────────────────────────

async function getExistingTitles() {
  const { data, error } = await supabase
    .from('library_documents')
    .select('title');

  if (error) throw new Error(`Failed to fetch existing titles: ${error.message}`);
  return new Set((data || []).map(d => d.title.toLowerCase()));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║       AdvisoryHub Library Build Script               ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (DRY_RUN) console.log('🔍 DRY RUN MODE -- no database writes\n');
  if (FOLDER_FILTER) console.log(`📁 Folder filter: "${FOLDER_FILTER}"\n`);

  // Verify library root exists
  if (!fs.existsSync(LIBRARY_ROOT)) {
    console.error(`❌ Library root not found: ${LIBRARY_ROOT}`);
    console.error('   Set LIBRARY_PATH environment variable or update LIBRARY_ROOT in script.');
    process.exit(1);
  }

  // Get all files
  let allFiles = walkDir(LIBRARY_ROOT);

  // Apply folder filter if set
  if (FOLDER_FILTER) {
    allFiles = allFiles.filter(f => f.includes(FOLDER_FILTER));
  }

  console.log(`📚 Found ${allFiles.length} files in library`);

  // Get existing titles to skip duplicates
  let existingTitles = new Set();
  if (!DRY_RUN) {
    console.log('🔎 Checking existing documents in database...');
    existingTitles = await getExistingTitles();
    console.log(`   ${existingTitles.size} documents already in database\n`);
  }

  // Process stats
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let inserted = 0;

  // Process each file
  for (const filePath of allFiles) {
    const title = deriveTitle(filePath);
    const { domain, tier, category, jurisdiction } = deriveMetadata(filePath);
    const relPath = path.relative(LIBRARY_ROOT, filePath);

    // Skip if already in database
    if (existingTitles.has(title.toLowerCase())) {
      console.log(`  ⏭  SKIP  ${relPath} (already in database)`);
      skipped++;
      continue;
    }

    console.log(`  ⚙  PROCESSING  ${relPath}`);
    console.log(`       domain=${domain} | tier=${tier} | category=${category}`);

    processed++;

    if (DRY_RUN) {
      console.log(`       [DRY RUN] Would insert: "${title}"`);
      continue;
    }

    try {
      // Extract text
      const content = await extractText(filePath);

      if (!content || content.trim().length < 50) {
        console.warn(`  ⚠  SKIP  ${relPath} (insufficient text extracted -- ${content?.length || 0} chars)`);
        skipped++;
        processed--;
        continue;
      }

      console.log(`       extracted ${content.length} chars`);

      // Generate embedding
      const embedding = await embed(content);
      console.log(`       embedded ✓`);

      // Insert into Supabase
      const { error } = await supabase.from('library_documents').insert({
        title,
        category,
        domain,
        jurisdiction,
        description: `${domain} -- ${category} -- ${tier}`,
        content: content.slice(0, MAX_CONTENT_CHARS),
        embedding,
        is_admin_managed: true,
        default_enabled: true,
      });

      if (error) {
        console.error(`  ❌ INSERT FAILED  ${relPath}: ${error.message}`);
        failed++;
      } else {
        console.log(`  ✅ INSERTED  "${title}"`);
        inserted++;
      }

      // Rate limit delay
      await new Promise(r => setTimeout(r, EMBED_DELAY_MS));

    } catch (err) {
      console.error(`  ❌ ERROR  ${relPath}: ${err.message}`);
      failed++;
    }
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║                    Build Complete                    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Total files found:    ${allFiles.length}`);
  console.log(`  Processed:            ${processed}`);
  console.log(`  Inserted:             ${inserted}`);
  console.log(`  Skipped (duplicate):  ${skipped}`);
  console.log(`  Failed:               ${failed}`);
  if (DRY_RUN) console.log('\n  DRY RUN -- no changes made to database');
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
