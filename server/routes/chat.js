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

    res.write(`data: ${JSON.stringify({ status: 'Understanding your question...' })}\n\n`);
    const queryEmbedding = await embed(userQuery);

    // 4. Retrieve relevant session memories
    res.write(`data: ${JSON.stringify({ status: 'Checking what we have covered in past sessions...' })}\n\n`);
    const { data: memories } = await supabase.rpc('match_sessions', {
      query_embedding: queryEmbedding,
      match_user_id: userId,
      match_threshold: 0.7,
      match_count: 3,
    });

    if (memories && memories.length > 0) {
      res.write(`data: ${JSON.stringify({ status: `Found ${memories.length} relevant lesson${memories.length !== 1 ? 's' : ''} from your past sessions` })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ status: 'No prior session context found — starting fresh' })}\n\n`);
    }

    // 5. Retrieve relevant library documents
    res.write(`data: ${JSON.stringify({ status: 'Searching frameworks, legislation and skills library...' })}\n\n`);
    const { data: libraryDocs } = await supabase.rpc('match_library', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: 8,
      p_user_id: userId,
      p_project_id: projectId || null,
    });

    if (libraryDocs && libraryDocs.length > 0) {
      // Separate skills from other docs for more descriptive messaging
      const skills = libraryDocs.filter(d => d.category === 'Skills');
      const frameworks = libraryDocs.filter(d => d.category === 'Framework' || d.category === 'Best Practice' || d.category === 'Legislation');
      const projectDocs = libraryDocs.filter(d => d.project_id);
      const other = libraryDocs.filter(d => !skills.includes(d) && !frameworks.includes(d) && !projectDocs.includes(d));

      if (skills.length > 0) {
        res.write(`data: ${JSON.stringify({ status: `Applying skill${skills.length !== 1 ? 's' : ''}: ${skills.map(d => d.title).join(', ')}` })}\n\n`);
      }
      if (frameworks.length > 0) {
        const names = frameworks.slice(0, 2).map(d => d.title).join(', ');
        res.write(`data: ${JSON.stringify({ status: `Referencing: ${names}${frameworks.length > 2 ? ` and ${frameworks.length - 2} more` : ''}` })}\n\n`);
      }
      if (projectDocs.length > 0) {
        res.write(`data: ${JSON.stringify({ status: `Reading ${projectDocs.length} project document${projectDocs.length !== 1 ? 's' : ''} from your active project` })}\n\n`);
      }
    } else {
      res.write(`data: ${JSON.stringify({ status: 'No closely matched library documents found' })}\n\n`);
    }

    // 6. Assemble system prompt
    const isGuided = mode !== 'direct';

    // Report profile context
    if (profile) {
      const profileParts = [];
      if (profile.role) profileParts.push(profile.role);
      if (profile.service_area) profileParts.push(profile.service_area);
      if (profileParts.length > 0) {
        res.write(`data: ${JSON.stringify({ status: `Tailoring response for: ${profileParts.join(', ')}` })}\n\n`);
      }
      if (profile.preferences && isGuided) {
        res.write(`data: ${JSON.stringify({ status: 'Applying your communication style preferences...' })}\n\n`);
      }
    }

    // Report project context
    if (project) {
      res.write(`data: ${JSON.stringify({ status: `Applying project context: ${project.name}` })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ status: 'Composing your response...' })}\n\n`);

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
