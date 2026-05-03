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

const PROJECT_THRESHOLD = 0.3;
const LIBRARY_THRESHOLD = 0.55;
const PROJECT_MATCH_COUNT = 6;
const LIBRARY_MATCH_COUNT = 8;

// =============================================================================
// Tool definitions (FEAT-WORD)
// =============================================================================
// Stage 1: scratch Word documents.
// Stage 2: optional template parameter for branded document templates.
//   - 'briefing_note' uses the Gold Coast briefing note template (logo,
//     metadata table, Heading2 styling, footer, page numbers).
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
      'the tool. ' +
      '\n\n' +
      'TEMPLATES: When the user asks for a briefing note and works for the ' +
      'City of Gold Coast (or has not specified a different organisation), ' +
      'use template="briefing_note". This produces a properly branded Gold ' +
      'Coast briefing note with logo and standard metadata fields. Before ' +
      'calling the tool with a template, ASK the user for any metadata you ' +
      'do not know: To (recipient), From (author), Copy, Action by, File no. ' +
      'You may default Subject to the document title and Date to today. ' +
      'It is acceptable to leave optional fields blank if the user has not ' +
      'provided them and does not want to be asked again. ' +
      '\n\n' +
      'After the tool runs you will receive the download URL and must include ' +
      'it in your response to the user as a Markdown link so they can ' +
      'download the document.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'The document title. Should be specific and descriptive, e.g. ' +
            '"Procurement Threshold Review for FY2026" rather than just ' +
            '"Briefing Note". For briefing notes this becomes the Subject ' +
            'field unless metadata.subject is provided separately.',
        },
        template: {
          type: 'string',
          enum: ['briefing_note'],
          description:
            'Optional template name. When set, the document is rendered into ' +
            'the named branded template. ' +
            'Use "briefing_note" for City of Gold Coast briefing notes; this ' +
            'is the recommended default when a Gold Coast user asks for a ' +
            'briefing note. Omit this field to produce a generic AdvisoryHub-' +
            'styled document from scratch.',
        },
        metadata: {
          type: 'object',
          description:
            'Document metadata fields. Required when template="briefing_note": ' +
            'supply To, From, Subject, Date as a minimum. Copy, Action by, ' +
            'and File no are optional but supply them when known. Ask the ' +
            'user for missing required fields before calling the tool.',
          properties: {
            to: {
              type: 'string',
              description: 'Primary recipient. e.g. "Director, Corporate Governance".',
            },
            copy: {
              type: 'string',
              description: 'Carbon copy recipients. Optional.',
            },
            from: {
              type: 'string',
              description: 'Author. Use the user\'s name and role from their profile, ' +
                'e.g. "Scott Stewart, Manager Risk and Insurance".',
            },
            action_by: {
              type: 'string',
              description: 'Person responsible for action, or action deadline. ' +
                'e.g. "15 May 2026" or "CFO by 15 May 2026". Optional.',
            },
            subject: {
              type: 'string',
              description: 'Subject line. Defaults to the document title if omitted.',
            },
            date: {
              type: 'string',
              description: 'Document date. Defaults to today\'s date if omitted. ' +
                'Format as a natural date, e.g. "3 May 2026".',
            },
            file_no: {
              type: 'string',
              description: 'Council file reference number. Ask the user; do not ' +
                'invent. Optional - leave blank if not provided.',
            },
          },
        },
        subtitle: {
          type: 'string',
          description:
            'Optional subtitle. Used by the scratch builder (no template). ' +
            'Ignored when a template is in use; use metadata.subject instead.',
        },
        organisation: {
          type: 'string',
          description:
            'Optional organisation name. Used by the scratch builder. ' +
            'Ignored when a template is in use (templates have their own branding).',
        },
        sections: {
          type: 'array',
          description:
            'The body of the document, organised into sections. Each section ' +
            'has a heading and content (paragraphs and/or bullets). Order ' +
            'sections logically. For a briefing note, a typical structure is ' +
            'Purpose, Background, Discussion, Risks, Recommendation, Next Steps - ' +
            'omit sections that aren\'t relevant.',
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
                  'Heading level. 2 by default. Used only by the scratch ' +
                  'builder; templates apply their own consistent heading style.',
              },
              paragraphs: {
                type: 'array',
                description:
                  'Body paragraphs for this section. Plain text. Do not use ' +
                  'markdown syntax. For bullet lists, use the bullets field.',
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
            required: ['heading'],
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

async function executeCreateWordDocument(input, { userId, sessionId, res }) {
  const title = (input && input.title) || 'document';
  const usingTemplate = input && typeof input.template === 'string';
  const templateLabel = usingTemplate
    ? `${input.template.replace(/_/g, ' ')} template`
    : 'Word document';
  emitStatus(res, `Creating ${templateLabel}: ${title}`);

  const buffer = await buildWordDocument(input);
  const filename = safeFilename(title);
  const storagePath = `${userId}/${sessionId}/${filename}`;
  const { signedUrl } = await uploadAndSign(buffer, storagePath, WORD_MIME);

  emitStatus(res, `Document ready: ${filename}`);

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

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    const finalMessage = await stream.finalMessage();

    if (finalMessage.stop_reason !== 'tool_use') {
      return;
    }

    const toolUseBlocks = finalMessage.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      return;
    }

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

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: finalMessage.content },
      { role: 'user', content: toolResults },
    ];
  }

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
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    let project = null;
    if (projectId) {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();
      project = data;
    }

    const userQuery = messages[messages.length - 1].content;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    emitStatus(res, 'Reading your question...');
    const queryEmbedding = await embed(userQuery);

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

    await streamWithTools({
      baseParams: {
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
// =============================================================================

function buildSystemPrompt(profile, project, memories, libraryDocs, isGuided) {

  let prompt =
    'You are AdvisoryHub, an AI-powered advisory assistant for local government ' +
    'officers in Queensland, Australia. You specialise in Risk and Audit, Contract ' +
    'Management, and General advisory across procurement, governance, and operations. ' +
    'You provide expert guidance drawing on best practice frameworks, Queensland ' +
    'legislation including the Local Government Act 2009 and Local Government Regulation ' +
    '2012, and Queensland Audit Office better practice guidelines. You cite your sources ' +
    'when drawing on retrieved documents.';

  // Document creation capability and template-aware behaviour
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
    'Markdown link in your reply.\n\n' +
    '### Templates\n' +
    'For Gold Coast briefing notes, set template="briefing_note" in the ' +
    'tool call. This applies the official Gold Coast template (logo, ' +
    'metadata table, standard fonts and footer). Before calling the tool ' +
    'with this template, ask the user for the metadata fields you do not ' +
    'know:\n' +
    '- To (recipient): required\n' +
    '- From (author): default to the user\'s name and role from their profile\n' +
    '- Copy: optional\n' +
    '- Action by: optional\n' +
    '- File no: optional, ask if relevant\n' +
    '- Subject: defaults to document title\n' +
    '- Date: defaults to today\n' +
    'Do not invent values for these fields. Ask the user, accept that the ' +
    'user may want to leave some blank, then proceed.';

  const prefs = effectivePreferences(profile, project);

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
    if (project.custom_instructions) prompt += `\nProject Instructions: ${project.custom_instructions}`;
  }

  if (memories && memories.length > 0) {
    prompt += `\n\n## Relevant Past Context`;
    memories.forEach(m => { prompt += `\n- ${m.content}`; });
  }

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
