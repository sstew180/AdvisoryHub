// =============================================================================
// Card #271: Embedding Quality Comparison
// OpenAI text-embedding-3-small vs Titan Text Embeddings V2
//
// 1. Parses 20 queries from embedding-test-queries.md
// 2. Generates ground truth via Claude (direct Anthropic API as judge)
// 3. Runs OpenAI top-5 retrieval on the library
// 4. Runs Titan top-5 retrieval on the library
// 5. Computes recall@5 per query and average per provider
// 6. Writes embedding-quality-report.md and qualitative-spot-check.md
//
// Pass criterion: Titan avg recall@5 >= 80% of OpenAI avg recall@5
//
// Run from server/ directory:
//   node scripts/sovereignty/runQualityComparison.js
// =============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require('@aws-sdk/client-bedrock-runtime');

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'ap-southeast-2',
});

const TITAN_MODEL_ID = process.env.BEDROCK_TITAN_MODEL_ID;
const JUDGE_MODEL_ID = 'claude-sonnet-4-6';

const QUERIES_FILE = path.join(__dirname, 'embedding-test-queries.md');
const REPORT_FILE = path.join(__dirname, 'embedding-quality-report.md');
const SPOTCHECK_FILE = path.join(__dirname, 'qualitative-spot-check.md');

// Spot-check queries (spread across domains)
const SPOTCHECK_IDS = ['Q03', 'Q08', 'Q12', 'Q16', 'Q19'];

// Pass threshold: Titan must hit at least this fraction of OpenAI's recall
const PASS_THRESHOLD = 0.80;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function parseEmbedding(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return JSON.parse(v);
  throw new Error('Unknown embedding format');
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function topK(queryVec, docs, embKey, k) {
  const scored = docs
    .filter(d => d[embKey])
    .map(d => ({
      title: d.title,
      score: cosineSim(queryVec, d[embKey]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored;
}

function recallAt5(truthTitles, providerTop5) {
  const truthSet = new Set(truthTitles);
  const hits = providerTop5.filter(r => truthSet.has(r.title)).length;
  return hits / 5;
}

// -----------------------------------------------------------------------------
// Parse queries from markdown
// -----------------------------------------------------------------------------

function parseQueries(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const queries = [];

  // Match: ### Q01 (type) followed by the query text on subsequent line
  const blockRegex = /^### (Q\d+)\s*\(([^)]+)\)\s*$\n+(.+?)(?=\n\n|\n\*Notes)/gms;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const id = match[1];
    const type = match[2].trim();
    const query = match[3].trim();
    queries.push({ id, type, query });
  }

  return queries;
}

// -----------------------------------------------------------------------------
// Embedding helpers
// -----------------------------------------------------------------------------

async function embedOpenAI(text) {
  const r = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),
  });
  return r.data[0].embedding;
}

async function embedTitan(text) {
  const body = {
    inputText: text.slice(0, 8000),
    dimensions: 1024,
    normalize: true,
  };
  const response = await bedrock.send(new InvokeModelCommand({
    modelId: TITAN_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  }));
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

// -----------------------------------------------------------------------------
// LLM judge: Claude picks the top 5 docs for each query
// -----------------------------------------------------------------------------

function buildJudgePrompt(query, docs) {
  const docList = docs
    .map((d, i) => {
      const desc = (d.description || d.content || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      return `${i + 1}. ${d.title} | ${desc}`;
    })
    .join('\n');

  return `You are evaluating which library documents are most relevant to a user query about Queensland local government practice (risk, audit, contracts, governance).

Query: "${query}"

Candidate documents (numbered 1 to ${docs.length}):
${docList}

Pick the 5 documents that best answer this query. Consider relevance only, not document length or quality.

Respond with ONLY a JSON object in this exact format:
{"top5": [n1, n2, n3, n4, n5]}

where n1-n5 are the document numbers (1-based). No explanation, no markdown fences.`;
}

async function getLLMTruth(query, docs) {
  const prompt = buildJudgePrompt(query, docs);

  const response = await anthropic.messages.create({
    model: JUDGE_MODEL_ID,
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  // Handle possible markdown fences
  const jsonStr = raw.replace(/^```json\s*|\s*```$/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Could not parse judge response: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.top5) || parsed.top5.length !== 5) {
    throw new Error(`Judge returned invalid top5: ${JSON.stringify(parsed)}`);
  }

  return parsed.top5.map(n => {
    if (n < 1 || n > docs.length) {
      throw new Error(`Judge returned invalid index ${n}`);
    }
    return docs[n - 1].title;
  });
}

// -----------------------------------------------------------------------------
// Report writers
// -----------------------------------------------------------------------------

function writeReport(queries, openaiAvg, titanAvg, passed) {
  const lines = [];
  lines.push('# Card #271: Embedding Quality Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Provider | Avg recall@5 |`);
  lines.push(`|----------|------------:|`);
  lines.push(`| OpenAI text-embedding-3-small | ${(openaiAvg * 100).toFixed(1)}% |`);
  lines.push(`| Titan Text Embeddings V2 | ${(titanAvg * 100).toFixed(1)}% |`);
  lines.push('');
  lines.push(`Titan relative to OpenAI: **${(titanAvg / openaiAvg * 100).toFixed(1)}%**`);
  lines.push(`Pass threshold: ${PASS_THRESHOLD * 100}% relative`);
  lines.push('');
  lines.push(`**Result: ${passed ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Per-query Results');
  lines.push('');
  lines.push('| Query | OpenAI | Titan |');
  lines.push('|-------|------:|------:|');
  for (const q of queries) {
    lines.push(`| ${q.id} | ${(q.openaiRecall * 100).toFixed(0)}% | ${(q.titanRecall * 100).toFixed(0)}% |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Detail per Query');
  lines.push('');
  for (const q of queries) {
    lines.push(`### ${q.id} (${q.type})`);
    lines.push('');
    lines.push(`**Query:** ${q.query}`);
    lines.push('');
    lines.push(`**Ground truth (Claude judge):**`);
    q.truth.forEach(t => lines.push(`- ${t}`));
    lines.push('');
    lines.push(`**OpenAI top-5 (recall ${(q.openaiRecall * 100).toFixed(0)}%):**`);
    q.openai.forEach(r => {
      const hit = q.truth.includes(r.title) ? ' [HIT]' : '';
      lines.push(`- ${r.title} (${r.score.toFixed(3)})${hit}`);
    });
    lines.push('');
    lines.push(`**Titan top-5 (recall ${(q.titanRecall * 100).toFixed(0)}%):**`);
    q.titan.forEach(r => {
      const hit = q.truth.includes(r.title) ? ' [HIT]' : '';
      lines.push(`- ${r.title} (${r.score.toFixed(3)})${hit}`);
    });
    lines.push('');
  }

  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf-8');
}

function writeSpotCheck(queries) {
  const picks = queries.filter(q => SPOTCHECK_IDS.includes(q.id));
  const lines = [];
  lines.push('# Card #271: Qualitative Spot-Check');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Five queries spread across domains. For each, compare both top-5 lists. Pass = "comparable by professional judgement", even if ranking differs. Fail = Titan surfaces genuinely off-topic docs an officer would dismiss.`);
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const q of picks) {
    lines.push(`## ${q.id} (${q.type})`);
    lines.push('');
    lines.push(`**Query:** ${q.query}`);
    lines.push('');
    lines.push('**OpenAI top-5:**');
    q.openai.forEach(r => lines.push(`- ${r.title}`));
    lines.push('');
    lines.push('**Titan top-5:**');
    q.titan.forEach(r => lines.push(`- ${r.title}`));
    lines.push('');
    lines.push('Your call: ___ (pass / fail / borderline)');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  fs.writeFileSync(SPOTCHECK_FILE, lines.join('\n'), 'utf-8');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(70));
  console.log('Card #271: Embedding Quality Comparison');
  console.log('='.repeat(70));
  console.log('');

  // 1. Load queries
  const queries = parseQueries(QUERIES_FILE);
  console.log(`Loaded ${queries.length} queries from embedding-test-queries.md`);
  if (queries.length !== 20) {
    console.warn(`Expected 20 queries, got ${queries.length}. Continuing anyway.`);
  }

  // 2. Fetch all admin-managed docs with both embeddings
  console.log('Fetching library documents...');
  const { data: docsRaw, error } = await supabase
    .from('library_documents')
    .select('id, title, description, content, embedding, embedding_titan')
    .eq('is_admin_managed', true);

  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }

  const docs = docsRaw
    .filter(d => d.embedding && d.embedding_titan)
    .map(d => ({
      id: d.id,
      title: d.title,
      description: d.description,
      content: d.content,
      embedding: parseEmbedding(d.embedding),
      embedding_titan: parseEmbedding(d.embedding_titan),
    }));

  console.log(`Using ${docs.length} docs with both embeddings populated.`);
  console.log('');

  // 3. Generate ground truth via Claude
  console.log(`Generating ground truth (Claude as judge, ${queries.length} calls)...`);
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    process.stdout.write(`  [${i + 1}/${queries.length}] ${q.id}... `);
    try {
      q.truth = await getLLMTruth(q.query, docs);
      console.log('ok');
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      q.truth = [];
    }
  }
  console.log('');

  // 4. OpenAI retrieval
  console.log(`Running OpenAI retrieval (${queries.length} calls)...`);
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    process.stdout.write(`  [${i + 1}/${queries.length}] ${q.id}... `);
    const qEmb = await embedOpenAI(q.query);
    q.openai = topK(qEmb, docs, 'embedding', 5);
    console.log('ok');
  }
  console.log('');

  // 5. Titan retrieval
  console.log(`Running Titan retrieval (${queries.length} calls)...`);
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    process.stdout.write(`  [${i + 1}/${queries.length}] ${q.id}... `);
    const qEmb = await embedTitan(q.query);
    q.titan = topK(qEmb, docs, 'embedding_titan', 5);
    console.log('ok');
  }
  console.log('');

  // 6. Recall calculations
  let openaiSum = 0, titanSum = 0;
  for (const q of queries) {
    q.openaiRecall = recallAt5(q.truth, q.openai);
    q.titanRecall = recallAt5(q.truth, q.titan);
    openaiSum += q.openaiRecall;
    titanSum += q.titanRecall;
  }
  const openaiAvg = openaiSum / queries.length;
  const titanAvg = titanSum / queries.length;
  const relative = titanAvg / openaiAvg;
  const passed = relative >= PASS_THRESHOLD;

  // 7. Write reports
  writeReport(queries, openaiAvg, titanAvg, passed);
  writeSpotCheck(queries);

  // 8. Console summary
  console.log('='.repeat(70));
  console.log('RESULT');
  console.log('='.repeat(70));
  console.log(`OpenAI avg recall@5:    ${(openaiAvg * 100).toFixed(1)}%`);
  console.log(`Titan avg recall@5:     ${(titanAvg * 100).toFixed(1)}%`);
  console.log(`Titan relative:         ${(relative * 100).toFixed(1)}%`);
  console.log(`Pass threshold:         ${PASS_THRESHOLD * 100}%`);
  console.log(`Verdict:                ${passed ? 'PASS' : 'FAIL'}`);
  console.log('');
  console.log(`Full report: ${REPORT_FILE}`);
  console.log(`Spot check:  ${SPOTCHECK_FILE}`);
  console.log('');
  console.log('Tomorrow morning: read the spot-check file and confirm Titan results look reasonable.');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
