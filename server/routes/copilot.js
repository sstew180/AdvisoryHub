// server/routes/copilot.js
// Endpoints for Copilot Studio and Power Apps clients.
// All endpoints in this file are protected by copilotAuth middleware in index.js.

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { marked } = require('marked');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');

const {
  effectivePreferences,
  buildIdentityBlock,
  buildHardConstraintsBlock,
  buildWorkingStyleBlock,
  buildVoiceMarkersBlock,
  buildQualityBlock,
  buildLegacyPreferencesBlock,
  describeConfigurationSource,
} = require('../lib/prompts/preferenceMap');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// =============================================================================
// Retrieval thresholds (LIB-1: ported from AHP server/routes/chat.js)
// =============================================================================
// Two-tier retrieval. Project-scoped documents use a lower threshold so
// project-specific content surfaces reliably even when phrasing differs.
// The general library uses a higher threshold to avoid pulling in loosely
// relevant frameworks. Both calls go to the same match_library RPC, which
// requires p_user_id and p_project_id parameters.

const PROJECT_THRESHOLD = 0.3;
const LIBRARY_THRESHOLD = 0.55;
const PROJECT_MATCH_COUNT = 6;
const LIBRARY_MATCH_COUNT = 8;

// Configure marked for the rendering Power Apps HtmlText control supports.
// gfm gives line breaks on single newline; breaks ensures \n becomes <br>.
marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false,
});

// Helper: convert markdown text to HTML for clients that render HTML (Power Apps).
// Returns empty string if input is empty/null.
function toHtml(markdownText) {
  if (!markdownText) return '';
  try {
    return marked.parse(markdownText);
  } catch (err) {
    console.error('Markdown render failed, returning raw text:', err);
    return markdownText;
  }
}

async function getUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`Auth lookup failed: ${error.message}`);

  const user = data.users.find(
    u => u.email && u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) throw new Error(`No user found for email: ${email}`);
  return user;
}

function buildSystemPrompt({ profile, project, memories, libraryDocs, mode }) {
  const isGuided = mode !== 'direct';
  const prefs = effectivePreferences(profile, project);

  let prompt =
    'You are AdvisoryHub, an AI-powered advisory assistant for local ' +
    'government officers in Queensland, Australia. You specialise in ' +
    'advisory work across multiple domains. You provide expert guidance ' +
    'drawing on best practice frameworks, Queensland legislation, and ' +
    'applicable standards. You cite your sources when drawing on ' +
    'retrieved documents. You write clearly and professionally.';

  // Personalisation: address the user by their first name where natural
  if (profile && profile.first_name) {
    prompt +=
      `\n\nYou are speaking with ${profile.first_name}. ` +
      `Address them by their first name occasionally where it reads naturally, ` +
      `but do not overuse it. Never use their name in every paragraph or in ` +
      `headings; restrict use to greetings, transitions, or moments of direct address.`;
  }

  prompt += buildIdentityBlock(prefs);
  prompt += buildHardConstraintsBlock(prefs);

  if (isGuided) {
    prompt += buildWorkingStyleBlock(prefs);
    prompt += buildVoiceMarkersBlock(prefs);
  }

  prompt += buildQualityBlock(prefs);

  if (isGuided) {
    prompt += buildLegacyPreferencesBlock(prefs);
  }

  if (project) {
    prompt += `\n\n## Active Project: ${project.name}`;
    if (project.description) prompt += `\n${project.description}`;
    if (project.objectives) prompt += `\nObjectives: ${project.objectives}`;
    if (project.custom_instructions) {
      prompt += `\nProject Instructions: ${project.custom_instructions}`;
    }
  }

  if (memories && memories.length > 0) {
    prompt += `\n\n## Relevant Past Context`;
    memories.forEach(m => { prompt += `\n- ${m.content}`; });
  }

  // LIB-1: single merged section now carries both library and project docs.
  if (libraryDocs && libraryDocs.length > 0) {
    prompt += `\n\n## Relevant Frameworks, Guidance and Project Documents`;
    libraryDocs.forEach(d => {
      prompt += `\n\n### ${d.title}`;
      prompt += `\n${d.content.slice(0, 8000)}`;
      if (d.source_url) prompt += `\nSource: ${d.source_url}`;
    });
  }

  return prompt;
}

// ---- POST /api/copilot/chat ----
router.post('/chat', async (req, res) => {
  const body = req.body || {};
  const email = body.email;
  const message = body.message;
  const requestedSessionId = body.session_id || body.sessionId;
  const project_id = body.project_id || body.projectId;
  const mode = body.mode;

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

    // SESSION RESOLUTION:
    // 1. If requestedSessionId is provided, verify it exists in the sessions table.
    // 2. If it exists and belongs to this user, reuse it (preserves conversation context).
    // 3. If it doesn't exist OR doesn't belong to this user, create a new session.
    let activeSessionId = null;

    if (requestedSessionId) {
      const { data: existingSession } = await supabase
        .from('sessions')
        .select('id, user_id')
        .eq('id', requestedSessionId)
        .maybeSingle();
      if (existingSession && existingSession.user_id === userId) {
        activeSessionId = existingSession.id;
      }
    }

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

    const { error: userInsertError } = await supabase.from('messages').insert({
      session_id: activeSessionId,
      role: 'user',
      content: message,
    });
    if (userInsertError) {
      console.error('Failed to save user message:', userInsertError);
      throw new Error(`Could not save user message: ${userInsertError.message}`);
    }

    const queryEmbedding = await embed(message);

    const { data: memories } = await supabase.rpc('match_sessions', {
      query_embedding: queryEmbedding,
      match_user_id: userId,
      match_threshold: 0.7,
      match_count: 3,
    });

    // =========================================================================
    // LIB-1: Two-tier library retrieval (ported from AHP server/routes/chat.js)
    // =========================================================================
    // 1. Project-scoped retrieval (lower threshold) when a project is active.
    //    Filtered to records whose project_id matches; library items returned
    //    by this call are dropped here and picked up by the general call below.
    // 2. General library retrieval (higher threshold). Passes p_project_id: null
    //    so the RPC returns library items only.
    // 3. Dedup by id. Project-scoped results come first so they win the dedup
    //    when the same id appears in both result sets.
    // 4. Both calls log errors via console.error rather than silently swallowing.

    let projectScopedDocs = [];
    if (project_id) {
      const { data, error } = await supabase.rpc('match_library', {
        query_embedding: queryEmbedding,
        match_threshold: PROJECT_THRESHOLD,
        match_count: PROJECT_MATCH_COUNT,
        p_user_id: userId,
        p_project_id: project_id,
      });
      if (error) {
        console.error('Project-scoped retrieval error:', error);
      } else {
        projectScopedDocs = (data || []).filter(d => d.project_id === project_id);
      }
    }

    const { data: libraryHits, error: libraryError } = await supabase.rpc('match_library', {
      query_embedding: queryEmbedding,
      match_threshold: LIBRARY_THRESHOLD,
      match_count: LIBRARY_MATCH_COUNT,
      p_user_id: userId,
      p_project_id: null,
    });
    if (libraryError) {
      console.error('Library retrieval error:', libraryError);
    }

    const seen = new Set();
    const libraryDocs = [];
    for (const d of [...(projectScopedDocs || []), ...(libraryHits || [])]) {
      if (d && d.id && !seen.has(d.id)) {
        seen.add(d.id);
        libraryDocs.push(d);
      }
    }

    const systemPrompt = buildSystemPrompt({
      profile,
      project,
      memories,
      libraryDocs,
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

    const responseHtml = toHtml(responseText);

    const { error: assistantInsertError } = await supabase.from('messages').insert({
      session_id: activeSessionId,
      role: 'assistant',
      content: responseText,
    });
    if (assistantInsertError) {
      console.error('Failed to save assistant message:', assistantInsertError);
    }

    const citations = (libraryDocs || []).map(d => ({
      title: d.title,
      source_url: d.source_url || null,
      snippet: d.content.slice(0, 200),
    }));

    res.json({
      response_text: responseText,
      response_html: responseHtml,
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
router.post('/projects', async (req, res) => {
  const body = req.body || {};
  const email = body.email;
  const name = body.name;
  const description = body.description;
  const objectives = body.objectives;
  const module_id = body.module_id || body.moduleId;

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
  const { email } = req.query;
  const project_id = req.query.project_id || req.query.projectId;
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
// Returns each message with both content (markdown) and content_html (rendered)
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

    // Add content_html to each message so Power Apps can render via HtmlText
    const messagesWithHtml = (messages || []).map(m => ({
      ...m,
      content_html: m.role === 'assistant' ? toHtml(m.content) : m.content,
    }));

    res.json({
      session_id: session.id,
      project_id: session.project_id,
      title: session.title,
      messages: messagesWithHtml,
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