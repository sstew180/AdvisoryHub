// server/routes/copilot.js
// Endpoints for Copilot Studio and Power Apps clients.
// All endpoints in this file are protected by copilotAuth middleware in index.js.

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Helper: look up a Supabase auth user by email.
// For larger user bases, add an `email` column to profiles and query that directly.
async function getUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`Auth lookup failed: ${error.message}`);

  const user = data.users.find(
    u => u.email && u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) throw new Error(`No user found for email: ${email}`);
  return user;
}

// Helper: assemble the system prompt scaffold.
// Mirrors the structure used by the existing chat.js route.
function buildSystemPrompt(profile, project, memories, libraryDocs, projectDocs) {
  let prompt =
    'You are AdvisoryHub, an AI-powered advisory assistant for local ' +
    'government officers in Queensland, Australia. You specialise in ' +
    'advisory work across multiple domains. You provide expert guidance ' +
    'drawing on best practice frameworks, Queensland legislation, and ' +
    'applicable standards. You cite your sources when drawing on ' +
    'retrieved documents. You write clearly and professionally.';

  if (profile) {
    prompt += `\n\n## User Profile`;
    if (profile.role) prompt += `\nRole: ${profile.role}`;
    if (profile.service_area) prompt += `\nService Area: ${profile.service_area}`;
    if (profile.goals) prompt += `\nCurrent Objectives: ${profile.goals}`;
    if (profile.preferences) prompt += `\nCommunication Style: ${profile.preferences}`;
    if (profile.artefact_preference) prompt += `\nDefault Output Format: ${profile.artefact_preference}`;
    if (profile.high_scrutiny) {
      prompt += `\n\nHIGH SCRUTINY MODE: Flag all assumptions. Note limitations. Recommend verification before use.`;
    }
  }

  if (project) {
    prompt += `\n\n## Active Project: ${project.name}`;
    if (project.description) prompt += `\n${project.description}`;
    if (project.objectives) prompt += `\nObjectives: ${project.objectives}`;
    if (project.custom_instructions) prompt += `\nProject Instructions: ${project.custom_instructions}`;
  }

  if (memories && memories.length > 0) {
    prompt += `\n\n## Relevant Past Context`;
    memories.forEach(m => { prompt += `\n- ${m.content}`; });
  }

  if (libraryDocs && libraryDocs.length > 0) {
    prompt += `\n\n## Relevant Frameworks and Guidance`;
    libraryDocs.forEach(d => {
      prompt += `\n\n### ${d.title}`;
      prompt += `\n${d.content.slice(0, 8000)}`;
      if (d.source_url) prompt += `\nSource: ${d.source_url}`;
    });
  }

  if (projectDocs && projectDocs.length > 0) {
    prompt += `\n\n## Relevant Project Documents`;
    projectDocs.forEach(d => {
      prompt += `\n\n### ${d.filename}`;
      prompt += `\n${d.content.slice(0, 8000)}`;
    });
  }

  return prompt;
}

// ---- POST /api/copilot/chat ----
// Main chat endpoint. Synchronous: returns the full response as one JSON blob.
// Body: { email, message, session_id (optional), project_id (optional) }
router.post('/chat', async (req, res) => {
  const { email, message, session_id, project_id } = req.body || {};

  if (!email || !message) {
    return res.status(400).json({ error: 'email and message are required in the request body.' });
  }

  try {
    const user = await getUserByEmail(email);
    const userId = user.id;

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', userId).single();

    let project = null;
    if (project_id) {
      const { data } = await supabase
        .from('projects').select('*').eq('id', project_id).single();
      project = data;
    }

    let activeSessionId = session_id;
    if (!activeSessionId) {
      const { data: newSession, error: sessionError } = await supabase
        .from('sessions')
        .insert({
          user_id: userId,
          project_id: project_id || null,
          title: message.slice(0, 100),
        })
        .select()
        .single();
      if (sessionError) throw sessionError;
      activeSessionId = newSession.id;
    }

    await supabase.from('messages').insert({
      session_id: activeSessionId,
      role: 'user',
      content: message,
    });

    const queryEmbedding = await embed(message);

    const { data: memories } = await supabase.rpc('match_sessions', {
      query_embedding: queryEmbedding,
      match_user_id: userId,
      match_threshold: 0.7,
      match_count: 3,
    });

    const { data: libraryDocs } = await supabase.rpc('match_library', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: 5,
    });

    let projectDocs = [];
    if (project_id) {
      const { data } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_project_id: project_id,
        match_threshold: 0.7,
        match_count: 3,
      });
      projectDocs = data || [];
    }

    const { data: recentDesc } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', activeSessionId)
      .order('created_at', { ascending: false })
      .limit(20);
    const messageHistory = (recentDesc || []).reverse();

    const systemPrompt = buildSystemPrompt(
      profile, project, memories, libraryDocs, projectDocs
    );

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messageHistory.map(m => ({ role: m.role, content: m.content })),
    });

    const responseText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    await supabase.from('messages').insert({
      session_id: activeSessionId,
      role: 'assistant',
      content: responseText,
    });

    const citations = (libraryDocs || []).map(d => ({
      title: d.title,
      source_url: d.source_url || null,
      snippet: d.content.slice(0, 200),
    }));

    res.json({
      response_text: responseText,
      session_id: activeSessionId,
      citations,
      domain_pack: profile?.service_area || 'General',
      high_scrutiny_active: profile?.high_scrutiny || false,
    });
  } catch (err) {
    console.error('Copilot chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/copilot/profile?email=X ----
router.get('/profile', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });

  try {
    const user = await getUserByEmail(email);
    const { data: profile, error } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    if (error) throw error;
    res.json({ email: user.email, ...profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- PUT /api/copilot/profile ----
// Body: { email, role?, service_area?, goals?, preferences?, artefact_preference?, high_scrutiny? }
router.put('/profile', async (req, res) => {
  const { email, ...updates } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required in the body.' });

  try {
    const user = await getUserByEmail(email);
    const allowed = ['role', 'service_area', 'goals', 'preferences', 'artefact_preference', 'high_scrutiny'];
    const filtered = {};
    for (const key of allowed) {
      if (key in updates) filtered[key] = updates[key];
    }

    const { data, error } = await supabase
      .from('profiles').update(filtered).eq('id', user.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/copilot/projects?email=X ----
router.get('/projects', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });

  try {
    const user = await getUserByEmail(email);
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, description, objectives, artefact_preference, high_scrutiny, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/copilot/sessions?email=X&project_id=Y (project_id optional) ----
router.get('/sessions', async (req, res) => {
  const { email, project_id } = req.query;
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });

  try {
    const user = await getUserByEmail(email);
    let query = supabase
      .from('sessions')
      .select('id, title, summary, project_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (project_id) query = query.eq('project_id', project_id);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/copilot/library ----
router.get('/library', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('library_documents')
      .select('id, title, category, domain, jurisdiction, description, source_url')
      .order('category');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;