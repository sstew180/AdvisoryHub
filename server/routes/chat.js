const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
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
  describeConfigurationSource
} = require('../lib/prompts/preferenceMap');

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
      res.write(`data: ${JSON.stringify({ status: 'No prior session context found, starting fresh' })}\n\n`);
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

      if (isGuided) {
        const configSource = describeConfigurationSource(profile);
        if (configSource) {
          res.write(`data: ${JSON.stringify({ status: `Applying your ${configSource}...` })}\n\n`);
        }
      }
    }

    // Report project context
    if (project) {
      res.write(`data: ${JSON.stringify({ status: `Applying project context: ${project.name}` })}\n\n`);
      const overrideCount = project.preference_overrides
        ? Object.keys(project.preference_overrides).length
        : 0;
      if (overrideCount > 0 && isGuided) {
        res.write(`data: ${JSON.stringify({ status: `Applying ${overrideCount} project-level preference override${overrideCount !== 1 ? 's' : ''}` })}\n\n`);
      }
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

// =============================================================================
// buildSystemPrompt
// Assembly order matches v1.0 spec Section 3.4 and is unchanged in v2.0.
//
//   1. Core identity statement (sector pack)
//   2. User identity and context
//   3. Hard constraints (banned words, redactions, language) - always
//   4. Working style (Guided mode only)
//   5. Voice and language markers (Guided mode only, typically Phase 2+)
//   6. Quality requirements (high scrutiny, self audit) - always
//   7. Legacy free-form preferences - backward compatibility
//   8. Project context
//   9. Retrieved session memories
//  10. Retrieved framework, library, and project documents
//
// Project preference_overrides are merged on top of profile preferences
// before any block builder runs, via effectivePreferences().
// =============================================================================

function buildSystemPrompt(profile, project, memories, libraryDocs, isGuided) {

  // 1. Core identity statement
  let prompt =
    'You are AdvisoryHub, an AI-powered advisory assistant for local government ' +
    'officers in Queensland, Australia. You specialise in Risk and Audit, Contract ' +
    'Management, and General advisory across procurement, governance, and operations. ' +
    'You provide expert guidance drawing on best practice frameworks, Queensland ' +
    'legislation including the Local Government Act 2009 and Local Government Regulation ' +
    '2012, and Queensland Audit Office better practice guidelines. You cite your sources ' +
    'when drawing on retrieved documents.';

  // Compute effective preferences once
  const prefs = effectivePreferences(profile, project);

  // 2. User identity and context (always)
  prompt += buildIdentityBlock(prefs);

  // 3. Hard constraints (always)
  prompt += buildHardConstraintsBlock(prefs);

  // 4. Working style (Guided only)
  if (isGuided) {
    prompt += buildWorkingStyleBlock(prefs);
  }

  // 5. Voice and language markers (Guided only)
  if (isGuided) {
    prompt += buildVoiceMarkersBlock(prefs);
  }

  // 6. Quality requirements (always)
  prompt += buildQualityBlock(prefs);

  // 7. Legacy free-form preferences (backward compat, Guided only)
  if (isGuided) {
    prompt += buildLegacyPreferencesBlock(prefs);
  }

  // 8. Project context
  if (project) {
    prompt += `\n\n## Active Project: ${project.name}`;
    if (project.description) prompt += `\n${project.description}`;
    if (project.objectives) prompt += `\nObjectives: ${project.objectives}`;
    if (project.custom_instructions) prompt += `\nProject Instructions: ${project.custom_instructions}`;
  }

  // 9. Retrieved session memories
  if (memories && memories.length > 0) {
    prompt += `\n\n## Relevant Past Context`;
    memories.forEach(m => { prompt += `\n- ${m.content}`; });
  }

  // 10. Retrieved framework, library, and project documents
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
