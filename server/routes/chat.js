const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/', async (req, res) => {
  const { userId, sessionId, projectId, messages, mode } = req.body;
  try {
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    let project = null;
    if (projectId) {
      const { data } = await supabase.from('projects').select('*').eq('id', projectId).single();
      project = data;
    }
    const userQuery = messages[messages.length - 1].content;
    const queryEmbedding = await embed(userQuery);
    const { data: memories } = await supabase.rpc('match_sessions', {
      query_embedding: queryEmbedding, match_user_id: userId, match_threshold: 0.7, match_count: 3
    });
    const { data: libraryDocs } = await supabase.rpc('match_library', {
      query_embedding: queryEmbedding, match_threshold: 0.7, match_count: 5
    });
    let projectDocs = [];
    if (projectId) {
      const { data } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding, match_project_id: projectId, match_threshold: 0.7, match_count: 3
      });
      projectDocs = data || [];
    }
    const isGuided = mode !== 'direct';
    const systemPrompt = buildSystemPrompt(profile, project, memories, libraryDocs, projectDocs, isGuided);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6', max_tokens: 8192, system: systemPrompt, messages
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write('data: ' + JSON.stringify({ text: event.delta.text }) + '\n\n');
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function buildSystemPrompt(profile, project, memories, libraryDocs, projectDocs, isGuided) {
  let p = 'You are AdvisoryHub, an AI-powered advisory assistant for local government ' +
    'officers in Queensland, Australia. You specialise in Risk, Audit, and Insurance. ' +
    'You provide expert guidance drawing on best practice frameworks, Queensland legislation, ' +
    'and the Queensland Audit Office guidelines. You cite your sources. You write clearly and professionally.';
  if (profile) {
    p += '\n\n## User Profile';
    if (profile.role) p += '\nRole: ' + profile.role;
    if (profile.service_area) p += '\nService Area: ' + profile.service_area;
    if (profile.goals) p += '\nObjectives: ' + profile.goals;
    if (profile.preferences && isGuided) p += '\nStyle: ' + profile.preferences;
    if (profile.artefact_preference) p += '\nDefault output: ' + profile.artefact_preference;
    if (profile.high_scrutiny) p += '\n\nHIGH SCRUTINY MODE: Flag all assumptions. Recommend verification.';
  }
  if (project) {
    p += '\n\n## Active Project: ' + project.name;
    if (project.description) p += '\n' + project.description;
    if (project.objectives) p += '\nObjectives: ' + project.objectives;
    if (project.custom_instructions) p += '\nInstructions: ' + project.custom_instructions;
  }
  if (memories && memories.length > 0) {
    p += '\n\n## Relevant Past Context';
    memories.forEach(m => { p += '\n- ' + m.content; });
  }
  if (libraryDocs && libraryDocs.length > 0) {
    p += '\n\n## Relevant Frameworks and Guidance';
    libraryDocs.forEach(d => {
      p += '\n\n### ' + d.title + '\n' + d.content.slice(0, 8000);
      if (d.source_url) p += '\nSource: ' + d.source_url;
    });
  }
  if (projectDocs && projectDocs.length > 0) {
    p += '\n\n## Project Documents';
    projectDocs.forEach(d => { p += '\n\n### ' + d.filename + '\n' + d.content.slice(0, 8000); });
  }
  return p;
}

module.exports = router;

