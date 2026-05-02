// =============================================================================
// Card #270: Bedrock Smoke Test
// Verifies AWS Bedrock access for Claude Sonnet 4.6 and Titan Text Embeddings V2
// in ap-southeast-2 (Sydney).
//
// Run from server/ directory:
//   node scripts/sovereignty/bedrockSmoke.js
//
// Pass criteria:
//   - Claude returns a sensible response to "What is the capital of Queensland?"
//   - Titan returns a 1024-element numeric array for sample text
// =============================================================================

require('dotenv').config();

const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require('@aws-sdk/client-bedrock-runtime');

const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const CLAUDE_MODEL_ID = process.env.BEDROCK_CLAUDE_MODEL_ID;
const TITAN_MODEL_ID = process.env.BEDROCK_TITAN_MODEL_ID;

const client = new BedrockRuntimeClient({ region: REGION });

function divider(label) {
  console.log('\n' + '='.repeat(70));
  console.log(label);
  console.log('='.repeat(70));
}

async function testClaude() {
  divider('TEST 1: Claude Sonnet 4.6 on Bedrock');
  console.log(`Model ID: ${CLAUDE_MODEL_ID}`);
  console.log(`Region:   ${REGION}`);

  const prompt = 'What is the capital of Queensland? Answer in one sentence.';
  console.log(`Prompt:   ${prompt}\n`);

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  };

  const start = Date.now();
  try {
    const response = await client.send(new InvokeModelCommand({
      modelId: CLAUDE_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    }));
    const elapsed = Date.now() - start;

    const result = JSON.parse(new TextDecoder().decode(response.body));
    const text = result.content?.[0]?.text || '(no text returned)';
    const inputTokens = result.usage?.input_tokens || 0;
    const outputTokens = result.usage?.output_tokens || 0;

    console.log('Response:');
    console.log(`  ${text}`);
    console.log('');
    console.log(`Latency:       ${elapsed} ms`);
    console.log(`Input tokens:  ${inputTokens}`);
    console.log(`Output tokens: ${outputTokens}`);
    console.log('Status:        PASS');
    return true;
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`Status:        FAIL (${elapsed} ms)`);
    console.log(`Error:         ${err.name}: ${err.message}`);
    if (err.name === 'ResourceNotFoundException' || err.name === 'ValidationException') {
      console.log('');
      console.log('HINT: The model ID may be wrong. Check the exact ID in the AWS');
      console.log('      Bedrock console under Model catalog and update');
      console.log('      BEDROCK_CLAUDE_MODEL_ID in your .env file.');
      console.log('      Newer Claude models often require a regional inference');
      console.log('      profile prefix like "apac." in front of the model name.');
    }
    return false;
  }
}

async function testTitan() {
  divider('TEST 2: Titan Text Embeddings V2 on Bedrock');
  console.log(`Model ID: ${TITAN_MODEL_ID}`);
  console.log(`Region:   ${REGION}`);

  const sample =
    'A local government risk register documents identified risks, their likelihood, ' +
    'consequence, and the controls in place to manage them.';
  console.log(`Input:    "${sample.slice(0, 60)}..."\n`);

  const body = {
    inputText: sample,
    dimensions: 1024,
    normalize: true,
  };

  const start = Date.now();
  try {
    const response = await client.send(new InvokeModelCommand({
      modelId: TITAN_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    }));
    const elapsed = Date.now() - start;

    const result = JSON.parse(new TextDecoder().decode(response.body));
    const embedding = result.embedding;

    if (!Array.isArray(embedding)) {
      throw new Error('Response did not contain an embedding array');
    }
    if (embedding.length !== 1024) {
      throw new Error(`Expected 1024 dimensions, got ${embedding.length}`);
    }
    if (!embedding.every(n => typeof n === 'number')) {
      throw new Error('Embedding contains non-numeric values');
    }

    console.log('Response:');
    console.log(`  Dimensions:   ${embedding.length}`);
    console.log(`  First 5 vals: [${embedding.slice(0, 5).map(n => n.toFixed(4)).join(', ')}]`);
    console.log(`  Input tokens: ${result.inputTextTokenCount || 'n/a'}`);
    console.log('');
    console.log(`Latency:      ${elapsed} ms`);
    console.log('Status:       PASS');
    return true;
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`Status:       FAIL (${elapsed} ms)`);
    console.log(`Error:        ${err.name}: ${err.message}`);
    return false;
  }
}

async function main() {
  divider('AdvisoryHub Bedrock Smoke Test (Card #270)');
  console.log(`Date:     ${new Date().toISOString()}`);
  console.log(`Account:  ${process.env.AWS_ACCESS_KEY_ID ? process.env.AWS_ACCESS_KEY_ID.slice(0, 8) + '...' : '(no key found)'}`);

  if (!CLAUDE_MODEL_ID || !TITAN_MODEL_ID) {
    console.log('\nERROR: Missing env vars. Check that .env contains:');
    console.log('  BEDROCK_CLAUDE_MODEL_ID');
    console.log('  BEDROCK_TITAN_MODEL_ID');
    console.log('  AWS_ACCESS_KEY_ID');
    console.log('  AWS_SECRET_ACCESS_KEY');
    console.log('  AWS_REGION');
    process.exit(1);
  }

  const claudeOk = await testClaude();
  const titanOk = await testTitan();

  divider('SUMMARY');
  console.log(`Claude Sonnet 4.6:  ${claudeOk ? 'PASS' : 'FAIL'}`);
  console.log(`Titan Embeddings V2: ${titanOk ? 'PASS' : 'FAIL'}`);
  console.log('');

  if (claudeOk && titanOk) {
    console.log('Both models reachable. Phase 0 unblocked. Proceed to card #275.');
    process.exit(0);
  } else {
    console.log('One or more models unreachable. Fix before proceeding.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
