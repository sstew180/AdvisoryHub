// server/routes/copilot.js
// Endpoints for Copilot Studio and Power Apps clients.
// All endpoints in this file are protected by copilotAuth middleware in index.js.

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');

// SVR-4: Reuse the same preferenceMap that powers the AHP chat endpoint
// so AHC produces the same rich, configured system prompt as AHP.
const {
  effectivePreferences,
  buildIdentityBlock,
  buildHardConstraintsBlock,
  buildWorkingStyleBlock,
  buildVoiceMarkersBlock,
  buildQualityBlock,
  buildLegacyPreferencesBlock,
  describeConfigurationSource,
} = require('../lib/preferenceMap');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function getUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`Auth lookup failed: ${error.message}`);

  const user = data.users.find(
    u => u.email && u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) throw new Error(`No user found for email: ${email}`);
  return user;
}

// SVR-4: Rich system prompt assembly using preferenceMap blocks.
// Identity, HardConstraints, and Quality blocks always apply (even in Direct mode).
// WorkingStyle, VoiceMarkers, and LegacyPreferences are skipped when mode === 'direct'.
// Project context, memories, library docs, and project docs are always included.
function buildSystemPrompt({ profile, project, memories, libraryDocs, projectDocs, mode }) {
  const isGuided = mode !== 'direct';
  const prefs = effectivePreferences(profile, project);

  let prompt =
    'You are AdvisoryHub, an AI-powered advisory assistant for local ' +
    'government officers in Queensland, Australia. You specialise in ' +
    'advisory work across multiple domains. You provide expert guidance ' +
    'drawing on best practice frameworks, Queensland legislation, and ' +
    'applicable standards. You cite your sources when drawing on ' +
    'retrieved documents. You write clearly and professionally.';

  // Always-applied blocks
  prompt += buildIdentityBlock(prefs);
  prompt += buildHardConstraintsBlock(prefs);

  // Guided-only blocks
  if (isGuided) {
    prompt += buildWorkingStyleBlock(prefs);
    prompt += buildVoiceMarkersBlock(prefs);
  }

  // Always-applied: quality flags are not style preferences
  prompt += buildQualityBlock(prefs);

  // Guided-only: free-form preferences text
  if (isGuided) {
    prompt += buildLegacyPreferencesBlock(prefs);
  }

  // Project context (always)
  if (project) {
    prompt += `\n\n## Active Project: ${project.name}`;
    if (project.description) prompt += `\n${project.description}`;
    if (project.objectives) prompt += `\nObjectives: ${project.objectives}`;
    if (project.custom_instructions) {
      prompt += `\nProject Instructions: ${project.custom_instructions}`;
    }
  }

  // Memories (always)
  if (memories && memories.length > 0) {
    prompt += `\n\n## Relevant Past Context`;
    memories.forEach(m => { prompt += `\n- ${m.content}`; });
  }

  // Library docs (always)
  if (libraryDocs && libraryDocs.length > 0) {
    prompt += `\n\n## Relevant Frameworks and Guidance`;
    libraryDocs.forEach(d => {
      prompt += `\n\n### ${d.title}`;
      prompt += `\n${d.content.slice(0, 8000)}`;
      if (d.source_url) prompt += `\nSource: ${d.source_url}`;
    });
  }

  // Project docs (always)
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
// SVR-4: Now accepts mode ('guided' default, or 'direct' for unguided)
router.post('/chat', async (req, res) => {
  const { email, message, session_id, project_id, mode } = req.body || {};

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

    // Fetch prior conversation history BEFORE inserting current message
    const { data: priorDesc } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', activeSessionId)
      .order('created_at', { ascending: false })
      .limit(20);
    const priorHistory = (priorDesc || []).reverse();

    const messagesForClaude = [
      ...priorHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    // Save the user message
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

    const systemPrompt = buildSystemPrompt({
      profile,
      project,
      memories,
      libraryDocs,
      projectDocs,
      mode,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messagesForClaude,
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
      mode_active: mode === 'direct' ? 'direct' : 'guided',
      configuration_source: describeConfigurationSource(profile),
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
      .select('id, name, description, objectives, artefact_preference, high_scrutiny, module_id, created_at')
      .eq('user_id', user.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- POST /api/copilot/projects ----
// SVR-2: Creates a new project for the user.
// Body: { email, name, description?, objectives?, module_id? }
router.post('/projects', async (req, res) => {
  const { email, name, description, objectives, module_id } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'email is required in the body.' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required and cannot be blank.' });
  }

  try {
    const user = await getUserByEmail(email);

    const { data, error } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        name: name.trim(),
        description: description || null,
        objectives: objectives || null,
        module_id: module_id || null,
      })
      .select('id, name, description, objectives, artefact_preference, high_scrutiny, module_id, created_at')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('CreateProject error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/copilot/sessions?email=X&project_id=Y ----
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

// ---- GET /api/copilot/sessions/:id/messages?email=X ----
// SVR-1: Returns full message history for a session, ordered oldest first.
// Verifies session ownership before returning content.
router.get('/sessions/:id/messages', async (req, res) => {
  const { id: sessionId } = req.params;
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email query parameter is required.' });
  }
  if (!sessionId) {
    return res.status(400).json({ error: 'session id is required in the URL.' });
  }

  try {
    const user = await getUserByEmail(email);

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('id, user_id, project_id, title')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    if (session.user_id !== user.id) {
      return res.status(403).json({ error: 'Session does not belong to this user.' });
    }

    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (messagesError) throw messagesError;

    res.json({
      session_id: session.id,
      project_id: session.project_id,
      title: session.title,
      messages: messages || [],
    });
  } catch (err) {
    console.error('GetSessionMessages error:', err);
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

// ---- GET /api/copilot/modules?email=X ----
// Returns the 12 tile-displayed modules with per-user accessibility flags.
// Admin users see all modules as accessible regardless of user_modules grants.
router.get('/modules', async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'email query parameter is required.' });
  }

  try {
    const user = await getUserByEmail(email);
    const userId = user.id;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('access_tier, last_active_module')
      .eq('id', userId)
      .single();
    if (profileError) throw profileError;

    const isAdmin = profile?.access_tier === 'admin';
    const primaryModuleId = profile?.last_active_module;

    const { data: modules, error: modulesError } = await supabase
      .from('modules')
      .select('id, name, slug, description')
      .eq('display_on_tiles', true)
      .order('name');
    if (modulesError) throw modulesError;

    const { data: grants, error: grantsError } = await supabase
      .from('user_modules')
      .select('module_id')
      .eq('user_id', userId);
    if (grantsError) throw grantsError;

    const accessibleIds = new Set((grants || []).map(g => g.module_id));

    const result = modules.map(m => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      description: m.description,
      accessible: isAdmin || accessibleIds.has(m.id),
      isPrimary: m.id === primaryModuleId,
    }));

    res.json(result);
  } catch (err) {
    console.error('GetModules error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;