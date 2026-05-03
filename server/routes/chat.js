const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const { buildWordDocument, safeFilename, WORD_MIME } = require('../lib/buildWord');
const { uploadAndSign } = require('../lib/storage');
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

// =============================================================================
// Retrieval thresholds (Card #262, tiered retrieval)
// =============================================================================
// PROJECT documents are user-attached to the active project. Strong intent
// signal, so the threshold is generous. Even a loosely-related project
// document should surface so the model can weigh it.
//
// LIBRARY documents are general frameworks, legislation, and skills. Higher
// threshold so general matches are precise and don't dilute the prompt.
//
// Tuning history:
//   - 0.7  initial (matched original deployment guide default)
//   - 0.4  Card #262 first pass (still missed valid project docs)
//   - 0.3  Card #262 retune after smoke test of meta-action queries
//          (e.g. "Write an ARC paper about the draft risk appetite statement"
//          asks ABOUT a document rather than its content, so embeddings
//          score lower than literal content questions)
//
// If too many irrelevant docs surface, raise PROJECT_THRESHOLD a notch.
// =============================================================================

const PROJECT_THRESHOLD = 0.3;
const LIBRARY_THRESHOLD = 0.55;
const PROJECT_MATCH_COUNT = 6;
const LIBRARY_MATCH_COUNT = 8;

// =============================================================================
// Tool definitions (FEAT-WORD)
// =============================================================================
// AI-authored Word documents. Stage 1 covers Word only. Excel, PowerPoint,
// and PDF are deferred to follow-on cards.
//
// The tool description deliberately frames WHEN to use vs WHEN NOT to. The
// model decides based on user intent, so the description carries that signal.
// The system prompt also reminds the model of this capability (see
// buildSystemPrompt below).
// =============================================================================

const TOOLS = [
  {
    name: 'create_word_document',
    description:
      'Create a downloadable Microsoft Word document (.docx). ' +
      'Use this tool when the user requests a finished, formal deliverable ' +
      'such as a briefing note, memo, report, board paper, council paper, ' +
      'executive summary, position paper, draft letter, or other formal ' +
      'document the user would expect to download and edit. ' +
      'Do NOT use this tool for short answers, explanations, brainstorming, ' +
      'casual discussion, or content that fits naturally as a chat response. ' +
      'When the request is ambiguous (could be either a chat response or a ' +
      'document), briefly ask the user which they prefer before calling ' +
      'the tool. After the tool runs you will receive the download URL and ' +
      'must include it in your response to the user as a Markdown link so ' +
      'they can download the document.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'The document title. Should be specific and descriptive, e.g. ' +
            '"Briefing Note: Procurement Threshold Review" rather than just ' +
            '"Briefing Note".',
        },
        subtitle: {
          type: 'string',
          description:
            'Optional subtitle, often used for the document type or audience, ' +
            'e.g. "Prepared for the Audit and Risk Committee".',
        },
        organisation: {
          type: 'string',
          description:
            'Optional organisation name to display in the document header. ' +
            'If the user has indicated their organisation (e.g. City of Gold ' +
            'Coast), use that. Otherwise omit.',
        },
        sections: {
          type: 'array',
          description:
            'The body of the document, organised into sections. Each section ' +
            'has a heading and content (paragraphs and/or bullets). Order ' +
            'sections logically: typically Background or Context first, then ' +
            'Analysis or Discussion, then Recommendations or Next Steps.',
          items: {
            type: 'object',
            properties: {
              heading: {
                type: 'string',
                description: 'Section heading text.',
              },
              level: {
                type: 'integer',
                enum: [1, 2, 3],
                description:
                  'Heading level: 1 for major section, 2 for sub-section, ' +
                  '3 for detail. Use 2 by default. Only use 1 sparingly for ' +
                  'top-level divisions of a long document.',
              },
              paragraphs: {
                type: 'array',
                description:
                  'Body paragraphs for this section. Plain text. Do not use ' +
                  'markdown syntax (no **bold**, no _italics_, no # headings). ' +
                  'For bullet lists, use the bullets field instead.',
                items: { type: 'string' },
              },
              bullets: {
                type: 'array',
                description:
                  'Optional bullet list for this section. Plain text per item. ' +
                  'Do not include the bullet character; it is added automatically.',
                items: { type: 'string' },
              },
            },
            required: ['heading', 'level'],
          },
        },
      },
      required: ['title', 'sections'],
    },
  },
];

// =============================================================================
// Helpers for richer status messages (FEAT-STATUS)
// =============================================================================

function formatTitleList(items, maxNamed = 3) {
  if (!items || items.length === 0) return '';
  if (items.length <= maxNamed) {
    return items.map(d => d.title).join(', ');
  }
  const named = items.slice(0, maxNamed).map(d => d.title).join(', ');
  return `${named} and ${items.length - maxNamed} more`;
}

function emitStatus(res, message) {
  res.write(`data: ${JSON.stringify({ status: message })}\n\n`);
}

function displayName(profile) {
  if (!profile) return null;
  const first = (profile.first_name || '').trim();
  return first || null;
}

// =============================================================================
// Tool execution
// =============================================================================

/**
 * Execute the create_word_document tool. Builds the docx, uploads to Supabase
 * Storage, and returns a tool-result payload that includes the signed URL
 * plus instructions for Claude on how to surface it to the user.
 */
async function executeCreateWordDocument(input, { userId, sessionId, res }) {
  const title = (input && input.title) || 'document';
  emitStatus(res, `Creating Word document: ${title}`);

  const buffer = await buildWordDocument(input);
  const filename = safeFilename(title);
  const storagePath = `${userId}/${sessionId}/${filename}`;
  const { signedUrl } = await uploadAndSign(buffer, storagePath, WORD_MIME);

  emitStatus(res, `Document ready: ${filename}`);

  // Tool result: instruct Claude to surface the link in its reply. We
  // explicitly ask for a Markdown link because the frontend renders Markdown
  // and that gives the user a clickable download link inline in the chat.
  return (
    `Document created successfully.\n\n` +
    `Title: ${title}\n` +
    `Filename: ${filename}\n` +
    `Download URL: ${signedUrl}\n\n` +
    `Provide this URL to the user as a Markdown link in your response. ` +
    `Format the link exactly like this: [${filename}](${signedUrl}). ` +
    `After the link, briefly confirm the document is ready and ask whether ` +
    `they would like any revisions. Keep the surrounding text short; the ` +
    `document itself contains the substantive content.`
  );
}

// =============================================================================
// Streaming tool-use loop
// =============================================================================
// Pattern: stream Claude's response. If stop_reason is tool_use, run the
// requested tools, append assistant message + tool results to the message
// history, and stream the next round. Cap rounds to avoid runaway loops.
// =============================================================================

const TOOL_HANDLERS = {
  create_word_document: executeCreateWordDocument,
};

async function streamWithTools({ baseParams, res, context, maxRounds = 3 }) {
  let currentMessages = baseParams.messages;

  for (let round = 0; round < maxRounds; round++) {
    const stream = anthropic.messages.stream({
      ...baseParams,
      messages: currentMessages,
    });

    // Stream text deltas to the client as they arrive. Other event types
    // (tool_use deltas etc.) are buffered by the SDK and surfaced via
    // finalMessage(); we don't need to handle them here.
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    const finalMessage = await stream.finalMessage();

    // No tool call: we're done.
    if (finalMessage.stop_reason !== 'tool_use') {
      return;
    }

    const toolUseBlocks = finalMessage.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      return;
    }

    // Execute every tool the model invoked in this turn.
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      const handler = TOOL_HANDLERS[toolUse.name];
      try {
        const resultContent = handler
          ? await handler(toolUse.input, context)
          : `Unknown tool: ${toolUse.name}`;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: resultContent,
        });
      } catch (err) {
        console.error(`Tool error (${toolUse.name}):`, err);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Failed to execute tool: ${err.message}`,
        });
      }
    }

    // Append the assistant turn (which contains the tool_use blocks) and the
    // tool results, then loop.
    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: finalMessage.content },
      { role: 'user', content: toolResults },
    ];
  }

  // Exhausted rounds. Tell the user something went wrong rather than
  // silently truncate.
  res.write(
    `data: ${JSON.stringify({
      text: '\n\n(I hit the maximum number of tool rounds. The document above is what was produced.)',
    })}\n\n`
  );
}

// =============================================================================
// Main route
// =============================================================================

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

    emitStatus(res, 'Reading your question...');
    const queryEmbedding = await embed(userQuery);

    // 4. Retrieve relevant session memories
    emitStatus(res, 'Checking what we have discussed before...');
    const { data: memories } = await supabase.rpc('match_sessions', {
      query_embedding: queryEmbedding,
      match_user_id: userId,
      match_threshold: 0.7,
      match_count: 3,
    });

    if (memories && memories.length > 0) {
      emitStatus(
        res,
        `Drawing on ${memories.length} earlier conversation${memories.length !== 1 ? 's' : ''}`
      );
    }

    // 5. Tiered library retrieval
    emitStatus(res, 'Searching the library...');

    let projectScopedDocs = [];
    if (projectId) {
      const { data, error } = await supabase.rpc('match_library', {
        query_embedding: queryEmbedding,
        match_threshold: PROJECT_THRESHOLD,
        match_count: PROJECT_MATCH_COUNT,
        p_user_id: userId,
        p_project_id: projectId,
      });
      if (error) {
        console.error('Project-scoped retrieval error:', error);
      } else {
        projectScopedDocs = (data || []).filter(d => d.project_id === projectId);
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

    if (libraryDocs.length > 0) {
      const skills = libraryDocs.filter(d => d.category === 'Skills');
      const frameworks = libraryDocs.filter(d =>
        d.category === 'Framework' ||
        d.category === 'Best Practice' ||
        d.category === 'Legislation'
      );
      const projectDocs = libraryDocs.filter(d => d.project_id);

      if (projectDocs.length > 0) {
        emitStatus(res, `Reviewing project documents: ${formatTitleList(projectDocs, 3)}`);
      }
      if (skills.length > 0) {
        emitStatus(
          res,
          `Bringing in skill${skills.length !== 1 ? 's' : ''}: ${skills.map(d => d.title).join(', ')}`
        );
      }
      if (frameworks.length > 0) {
        emitStatus(res, `Cross-referencing: ${formatTitleList(frameworks, 2)}`);
      }
    }

    // 6. Personalisation status
    const isGuided = mode !== 'direct';

    if (profile) {
      const role = (profile.role || '').trim();
      const name = displayName(profile);

      if (role) {
        if (name) {
          emitStatus(res, `Tailoring this for ${name} as ${role}...`);
        } else {
          emitStatus(res, `Considering your role as ${role}...`);
        }
      }

      if (isGuided) {
        const configSource = describeConfigurationSource(profile);
        if (configSource) {
          emitStatus(res, `Aligning with your ${configSource}...`);
        }
      }
    }

    if (project) {
      emitStatus(res, `Keeping ${project.name} in mind...`);
      const overrideCount = project.preference_overrides
        ? Object.keys(project.preference_overrides).length
        : 0;
      if (overrideCount > 0 && isGuided) {
        emitStatus(
          res,
          `Applying ${overrideCount} project-specific preference${overrideCount !== 1 ? 's' : ''}`
        );
      }
    }

    emitStatus(res, 'Drafting your response...');

    const systemPrompt = buildSystemPrompt(profile, project, memories, libraryDocs, isGuided);

    // 7. Stream Claude with tool support
    await streamWithTools({
      baseParams: {
        // Bumped from 2048 to 8192 because document tool calls can produce
        // long structured input (briefing notes, board papers). 8192 leaves
        // ample room while staying well under model limits.
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: systemPrompt,
        tools: TOOLS,
        messages: messages,
      },
      res,
      context: { userId, sessionId, res },
    });

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error(err);
    if (res.headersSent) {
      try {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (writeErr) {
        console.error('Failed to write error to open SSE stream:', writeErr);
      }
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// =============================================================================
// buildSystemPrompt
// Assembly order matches v1.0 spec Section 3.4 and is unchanged in v2.0.
//
//   1.   Core identity statement (sector pack)
//   1.5  Document creation capability (FEAT-WORD)
//   2.   User identity and context
//   3.   Hard constraints (banned words, redactions, language) - always
//   4.   Working style (Guided mode only)
//   5.   Voice and language markers (Guided mode only, typically Phase 2+)
//   6.   Quality requirements (high scrutiny, self audit) - always
//   7.   Legacy free-form preferences - backward compatibility
//   8.   Project context
//   9.   Retrieved session memories
//  10.   Retrieved framework, library, and project documents
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

  // 1.5 Document creation capability
  prompt +=
    '\n\n## Document Creation\n' +
    'You can create downloadable Microsoft Word documents using the ' +
    'create_word_document tool. Use this tool when the user requests a ' +
    'finished, formal deliverable such as a briefing note, memo, report, ' +
    'board paper, council paper, executive summary, position paper, or ' +
    'draft letter. When the request is ambiguous (could be either a chat ' +
    'response or a document), briefly ask the user which they prefer ' +
    'before calling the tool. Do not use the tool for short answers, ' +
    'explanations, or casual discussion. After the tool runs you will ' +
    'receive a download URL which you must surface to the user as a ' +
    'Markdown link in your reply.';

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
