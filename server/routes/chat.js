const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/', async (req, res) => {
  const { userId, sessionId, projectId, messages, mode } = req.body;

  try {
    // 1. Fetch user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    // 2. Fetch project context (if active)
    let project = null;
    if (projectId) {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();
      project = data;
    }

    // 3. Embed current query for semantic retrieval
    const userQuery = messages[messages.length - 1].content;

    // Set SSE headers before any status messages
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write(`data: ${JSON.stringify({ status: 'Reading your question...' })}\n\n`);
    const queryEmbedding = await embed(userQuery);

    // 4. Retrieve relevant session memories
    res.write(`data: ${JSON.stringify({ status: 'Checking session memory...' })}\n\n`);
    const { data: memories } = await supabase.rpc('match_sessions', {
      query_embedding: queryEmbedding,
      match_user_id: userId,
      match_threshold: 0.7,
      match_count: 3,
    });

    if (memories && memories.length > 0) {
      res.write(`data: ${JSON.stringify({ status: `Found ${memories.length} relevant memor${memories.length !== 1 ? 'ies' : 'y'} from past sessions` })}\n\n`);
    }

    // 5. Retrieve relevant library documents
    res.write(`data: ${JSON.stringify({ status: 'Searching library...' })}\n\n`);
    const { data: libraryDocs } = await supabase.rpc('match_library', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: 8,
      p_user_id: userId,
      p_project_id: projectId || null,
    });

    if (libraryDocs && libraryDocs.length > 0) {
      // Report the most relevant docs by name
      const docNames = libraryDocs.slice(0, 3).map(d => d.title).join(', ');
      res.write(`data: ${JSON.stringify({ status: `Reading: ${docNames}${libraryDocs.length > 3 ? ` and ${libraryDocs.length - 3} more` : ''}` })}\n\n`);
    }

    // 6. Assemble system prompt
    const isGuided = mode !== 'direct';

    // Report profile context
    if (profile) {
      const profileParts = [];
      if (profile.role) profileParts.push(profile.role);
      if (profile.service_area) profileParts.push(profile.service_area);
      if (profileParts.length > 0) {
        res.write(`data: ${JSON.stringify({ status: `Applying your profile: ${profileParts.join(', ')}` })}\n\n`);
      }
    }

    // Report project context
    if (project) {
      res.write(`data: ${JSON.stringify({ status: `Active project: ${project.name}` })}\n\n`);
    }

    // Report mode
    res.write(`data: ${JSON.stringify({ status: isGuided ? 'Guided mode — applying communication preferences...' : 'Direct mode — drafting response...' })}\n\n`);

    let systemPrompt = buildSystemPrompt(profile, project, memories, libraryDocs, isGuided);

    // 7. Call Claude with SSE streaming (headers already set above)

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function buildSystemPrompt(profile, project, memories, libraryDocs, isGuided) {
  let prompt = 'You are AdvisoryHub, an AI-powered advisory assistant for local government ' +
    'officers in Queensland, Australia. You specialise in Risk, Audit, and Insurance. ' +
    'You provide expert guidance drawing on best practice frameworks, Queensland legislation, ' +
    'and the Queensland Audit Office guidelines. You cite your sources when drawing on ' +
    'retrieved documents. You write clearly and professionally.';

  // User profile context
  if (profile) {
    prompt += `\n\n## User Profile`;
    if (profile.role) prompt += `\nRole: ${profile.role}`;
    if (profile.service_area) prompt += `\nService Area: ${profile.service_area}`;
    if (profile.goals) prompt += `\nCurrent Objectives: ${profile.goals}`;
    if (profile.preferences && isGuided) prompt += `\nCommunication Style: ${profile.preferences}`;
    if (profile.artefact_preference) prompt += `\nDefault Output Format: ${profile.artefact_preference}`;
    if (profile.high_scrutiny) prompt += `\n\nHIGH SCRUTINY MODE: Flag all assumptions. Note limitations. Recommend verification before use.`;
  }

  // Project context
  if (project) {
    prompt += `\n\n## Active Project: ${project.name}`;
    if (project.description) prompt += `\n${project.description}`;
    if (project.objectives) prompt += `\nObjectives: ${project.objectives}`;
    if (project.custom_instructions) prompt += `\nProject Instructions: ${project.custom_instructions}`;
  }

  // Session memories
  if (memories && memories.length > 0) {
    prompt += `\n\n## Relevant Past Context`;
    memories.forEach(m => { prompt += `\n- ${m.content}`; });
  }

  // Library documents -- now includes user docs and project docs
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

module.exports = router;
