// =============================================================================
// Library Catalog Generator
// Lists all admin-managed library_documents grouped by category and domain.
// Output written to scripts/sovereignty/library-catalog.md.
//
// Used as a reference while annotating ground truth for Card #271.
//
// Run from server/ directory:
//   node scripts/sovereignty/buildCatalog.js
// =============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const OUTPUT_PATH = path.join(__dirname, 'library-catalog.md');

function truncate(text, max) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '...' : clean;
}

async function main() {
  console.log('Building library catalog...');

  const { data: docs, error } = await supabase
    .from('library_documents')
    .select('id, title, category, domain, jurisdiction, description, content')
    .eq('is_admin_managed', true)
    .order('category')
    .order('domain')
    .order('title');

  if (error) {
    console.error('Failed to fetch documents:', error.message);
    process.exit(1);
  }

  if (!docs || docs.length === 0) {
    console.log('No documents found.');
    process.exit(0);
  }

  console.log(`Fetched ${docs.length} documents.`);

  // Group by category
  const byCategory = {};
  for (const d of docs) {
    const cat = d.category || 'Uncategorised';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(d);
  }

  // Sort categories alphabetically
  const categories = Object.keys(byCategory).sort();

  // Build markdown
  const lines = [];
  lines.push('# AdvisoryHub Library Catalog');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total admin-managed documents: ${docs.length}`);
  lines.push('');
  lines.push('Organised by category, then domain, then title.');
  lines.push('');
  lines.push('Use the `title` column when annotating ground truth in `embedding-test-queries.md`.');
  lines.push('');
  lines.push('---');
  lines.push('');

  // Summary table at the top
  lines.push('## Summary');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('|----------|------:|');
  for (const cat of categories) {
    lines.push(`| ${cat} | ${byCategory[cat].length} |`);
  }
  lines.push(`| **Total** | **${docs.length}** |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Per-category sections
  for (const cat of categories) {
    const catDocs = byCategory[cat];
    lines.push(`## ${cat} (${catDocs.length})`);
    lines.push('');

    // Group within category by domain
    const byDomain = {};
    for (const d of catDocs) {
      const dom = d.domain || 'Unspecified';
      if (!byDomain[dom]) byDomain[dom] = [];
      byDomain[dom].push(d);
    }

    const domains = Object.keys(byDomain).sort();
    for (const dom of domains) {
      lines.push(`### ${dom}`);
      lines.push('');
      for (const d of byDomain[dom]) {
        const desc = truncate(d.description || d.content, 120);
        lines.push(`- **${d.title}**`);
        if (desc) lines.push(`  ${desc}`);
      }
      lines.push('');
    }
  }

  // Write file
  fs.writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf-8');
  console.log(`Catalog written to ${OUTPUT_PATH}`);
  console.log(`${docs.length} documents, ${categories.length} categories.`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
