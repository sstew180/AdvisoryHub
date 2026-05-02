// =============================================================================
// Card #275: Batch-embed library_documents with Titan V2
// Reads all rows where embedding_titan IS NULL, embeds them, writes back.
// Idempotent: safe to re-run, only processes unembedded rows.
//
// Run from server/ directory:
//   node scripts/sovereignty/embedTitanLibrary.js
// =============================================================================

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require('@aws-sdk/client-bedrock-runtime');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'ap-southeast-2',
});

const TITAN_MODEL_ID = process.env.BEDROCK_TITAN_MODEL_ID;

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
  if (!Array.isArray(result.embedding) || result.embedding.length !== 1024) {
    throw new Error(`Bad embedding response: ${JSON.stringify(result).slice(0, 200)}`);
  }
  return result.embedding;
}

async function main() {
  console.log('='.repeat(70));
  console.log('Card #275: Batch-embed library_documents with Titan V2');
  console.log('='.repeat(70));
  console.log(`Region: ${process.env.AWS_REGION || 'ap-southeast-2'}`);
  console.log(`Model:  ${TITAN_MODEL_ID}`);
  console.log('');

  if (!TITAN_MODEL_ID) {
    console.error('ERROR: BEDROCK_TITAN_MODEL_ID missing from .env');
    process.exit(1);
  }

  // Fetch all unembedded docs
  const { data: docs, error } = await supabase
    .from('library_documents')
    .select('id, title, content')
    .is('embedding_titan', null);

  if (error) {
    console.error('Failed to fetch documents:', error.message);
    process.exit(1);
  }

  if (!docs || docs.length === 0) {
    console.log('No documents need embedding. Already complete.');
    process.exit(0);
  }

  console.log(`Found ${docs.length} documents to embed.\n`);

  let success = 0;
  let failed = 0;
  const failedIds = [];
  const startTime = Date.now();

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const progressTag = `[${String(i + 1).padStart(3)}/${docs.length}]`;

    try {
      const text = doc.content || doc.title || '';
      if (!text.trim()) {
        throw new Error('empty content and title');
      }

      const embedding = await embedTitan(text);

      const { error: updateError } = await supabase
        .from('library_documents')
        .update({ embedding_titan: embedding })
        .eq('id', doc.id);

      if (updateError) {
        throw new Error(`update failed: ${updateError.message}`);
      }

      success++;

      // Progress every 10 docs and on the last doc
      if ((i + 1) % 10 === 0 || i === docs.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = ((i + 1) / parseFloat(elapsed)).toFixed(1);
        console.log(`${progressTag} ${elapsed}s, ${rate} docs/sec, ${success} ok, ${failed} failed`);
      }
    } catch (err) {
      failed++;
      failedIds.push({ id: doc.id, title: doc.title, error: err.message });
      console.log(`${progressTag} FAIL: ${doc.title || doc.id} - ${err.message}`);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total:    ${docs.length}`);
  console.log(`Success:  ${success}`);
  console.log(`Failed:   ${failed}`);
  console.log(`Elapsed:  ${totalElapsed}s`);

  if (failedIds.length > 0) {
    console.log('');
    console.log('Failed documents:');
    failedIds.forEach(f => {
      console.log(`  ${f.id} (${f.title || 'no title'}): ${f.error}`);
    });
    console.log('');
    console.log('Re-run the script to retry failed docs (idempotent).');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
