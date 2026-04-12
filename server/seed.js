// AdvisoryHub Demo Seed Script
// Usage: node seed.js --config seed-config-risk.json
// or:    node seed.js --config seed-config-audit.json
//
// Requires server/.env to be present with SUPABASE_URL and SUPABASE_SERVICE_KEY

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { embed } = require('./lib/embed');
const fs = require('fs');

const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
if (configIndex === -1 || !args[configIndex + 1]) {
  console.error('Usage: node seed.js --config seed-config-risk.json');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(args[configIndex + 1], 'utf-8'));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function seed() {
  const { userId, project, memories, sessions } = config;
  console.log(`\nSeeding demo for user ${userId}`);
  console.log(`Project: ${project.name}\n`);

  // 1. Create project
  console.log('Creating project...');
  const { data: proj, error: projErr } = await supabase.from('projects').insert({
    user_id: userId,
    name: project.name,
    description: project.description,
    objectives: project.objectives,
    custom_instructions: project.custom_instructions,
    high_scrutiny: project.high_scrutiny || false,
    profile_override: false,
  }).select().single();
  if (projErr) { console.error('Project error:', projErr.message); process.exit(1); }
  console.log(`Project created: ${proj.id}`);

  // 2. Create pinned memories
  console.log(`\nCreating ${memories.length} pinned memories...`);
  for (const mem of memories) {
    const content = '[PINNED NOTE] ' + mem;
    const embedding = await embed(content);
    const { data: sess } = await supabase.from('sessions').insert({
      user_id: userId,
      project_id: proj.id,
      title: 'Memory: ' + mem.slice(0, 40),
    }).select().single();
    await supabase.from('session_embeddings').insert({
      session_id: sess.id,
      user_id: userId,
      content,
      embedding,
    });
    console.log(`  Pinned: ${mem.slice(0, 60)}...`);
  }

  // 3. Create past sessions with messages
  console.log(`\nCreating ${sessions.length} past sessions...`);
  for (const s of sessions) {
    const { data: sess } = await supabase.from('sessions').insert({
      user_id: userId,
      project_id: proj.id,
      title: s.title,
      summary: s.summary,
    }).select().single();

    for (const msg of s.messages) {
      await supabase.from('messages').insert({
        session_id: sess.id,
        role: msg.role,
        content: msg.content,
      });
    }

    // Embed the summary for future retrieval
    if (s.summary) {
      const embedding = await embed(s.summary);
      await supabase.from('session_embeddings').insert({
        session_id: sess.id,
        user_id: userId,
        content: s.summary,
        embedding,
      });
    }
    console.log(`  Session: ${s.title}`);
  }

  console.log('\nSeed complete.');
  console.log(`Project ID: ${proj.id}`);
  console.log('Sign in to AdvisoryHub, go to Projects, and activate this project in chat.');
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
