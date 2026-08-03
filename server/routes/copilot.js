// server/routes/copilot.js
// Endpoints for Copilot Studio and Power Apps clients.
// All endpoints in this file are protected by copilotAuth middleware in index.js.

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { marked } = require('marked');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const { generateAndSaveTitle } = require('../lib/generateTitle');
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
const LIBRARY_THRESHOLD = 0.4;

// LIB-11: sized against the chunk size used at ingestion, not chosen in the
// abstract. What matters to the model is total retrieved CHARACTERS, not the
// number of rows:
//
//   6 rows  x 6,000-char chunks = 36,000 chars   (original)
//   10 rows x 2,000-char chunks = 20,000 chars   (after LIB-10, a coverage LOSS)
//   25 rows x 2,000-char chunks = 50,000 chars   (current)
//
// Cutting chunk size to 2,000 (LIB-10) sharpened precision, so a short clause
// buried in a long document now ranks. But holding the row count at 10 nearly
// halved the context the model actually sees, and the visible symptom was the
// model making confident claims about what a project does NOT contain while
// only ever seeing ten of several hundred rows. Negative claims need coverage,
// not just precision. Raise the two together or one undoes the other.
const PROJECT_MATCH_COUNT = 25;
const LIBRARY_MATCH_COUNT = 8;

// LIB-7 (revised): the always-include direct fetch below is only a genuine
// guarantee while a project holds few enough rows to return them all. Once a
// project holds chunked documents (a long contract can produce hundreds of
// rows) an unordered fetch capped at this number returns an arbitrary sample,
// which crowds the prompt without improving relevance. Above this count the
// direct fetch is skipped and similarity retrieval does the work, which is why
// PROJECT_MATCH_COUNT was raised alongside it (see LIB-11 above).
const PROJECT_DIRECT_INCLUDE_LIMIT = 10;

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

// =============================================================================
// PROF-1 Phase C: document creation tool
// =============================================================================
// AHC now exposes the same create_word_document capability as AHP, wired to
// all seven Gold Coast templates. Because Power Apps consumes a single JSON
// response (not a stream), the tool loop here is non-streaming: call Claude,
// if it requests the tool, run it, feed the result back, call again, until
// Claude returns a final text answer.

const TOOLS = [
  {
    name: 'create_word_document',
    description:
      'Create a downloadable Microsoft Word document (.docx). Use this tool ' +
      'when the user requests a finished, formal deliverable they would expect ' +
      'to download and edit (briefing note, analysis, governance/council paper, ' +
      'status report, meeting minutes, options analysis, or a formal email). ' +
      'Do NOT use it for short answers, explanations, brainstorming, or casual ' +
      'discussion. When the request is ambiguous (could be a chat answer or a ' +
      'document), briefly ask the user which they want before calling the tool. ' +
      '\n\n' +
      'Always set the template that matches the request:\n' +
      '- briefing_note: a briefing note directed at a recipient (uses To, From, Action by). Always use this for any briefing note.\n' +
      '- analysis_summary: a self-driven analysis or review of a question, no formal recipient.\n' +
      '- governance_paper: a paper for a council meeting, board, or committee, put forward for noting, endorsement, or decision.\n' +
      '- status_report: a periodic update on a function, program, or initiative, defined by a period covered.\n' +
      '- meeting_notes: minutes of a meeting (attendees, apologies, agenda items with discussion, decisions, actions).\n' +
      '- options_analysis: a comparison of two or more options against criteria to inform a decision.\n' +
      '- formal_email: a polished email (salutation, body, sign-off, signature).\n\n' +
      'Populate metadata from the user profile where natural (e.g. author or from = the user\'s name and role). Ask the user for fields you cannot infer; do not invent file numbers or references. Accept blank optional fields. ' +
      '\n\n' +
      'After the tool runs you receive a download URL. Include it in your reply ' +
      'to the user as a Markdown link so they can download the document.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'The document title. Specific and descriptive, e.g. ' +
            '"Procurement Threshold Review for FY2026".',
        },
        template: {
          type: 'string',
          enum: [
            'briefing_note',
            'analysis_summary',
            'governance_paper',
            'status_report',
            'meeting_notes',
            'options_analysis',
            'formal_email',
          ],
          description: 'Which template to use. Required. Pick the best match for the request.',
        },
        metadata: {
          type: 'object',
          description:
            'Metadata fields. Which apply depends on the template; fill the ' +
            'relevant ones and omit the rest.',
          properties: {
            to:             { type: 'string', description: 'Recipient (briefing_note) or meeting body (governance_paper) or addressee (formal_email).' },
            copy:           { type: 'string', description: 'Carbon copy. briefing_note.' },
            from:           { type: 'string', description: 'Author/sender. briefing_note, formal_email. Use the user name and role.' },
            action_by:      { type: 'string', description: 'Action owner or deadline. briefing_note.' },
            subject:        { type: 'string', description: 'Subject line. briefing_note, analysis_summary, formal_email. Defaults to title.' },
            date:           { type: 'string', description: 'Date. briefing_note, analysis_summary, options_analysis. Defaults to today.' },
            file_no:        { type: 'string', description: 'File reference. briefing_note.' },
            author:         { type: 'string', description: 'Author name and role. analysis_summary, governance_paper, status_report, options_analysis.' },
            reference:      { type: 'string', description: 'Document or file reference. analysis_summary, governance_paper, status_report, options_analysis, meeting_notes.' },
            title:          { type: 'string', description: 'Prominent title for governance_paper, status_report, meeting_notes, options_analysis. Defaults to the top-level title.' },
            meeting_date:   { type: 'string', description: 'Meeting date. governance_paper.' },
            decision_type:  { type: 'string', description: 'For Noting, For Endorsement, or For Decision. governance_paper.' },
            period_covered: { type: 'string', description: 'Reporting period, e.g. "1 May 2026 - 31 May 2026". status_report.' },
            date_prepared:  { type: 'string', description: 'Date prepared. status_report.' },
            time:           { type: 'string', description: 'Meeting time. meeting_notes.' },
            location:       { type: 'string', description: 'Meeting location. meeting_notes.' },
            chair:          { type: 'string', description: 'Meeting chair. meeting_notes.' },
            minute_taker:   { type: 'string', description: 'Minute taker. meeting_notes.' },
            decision_sought:{ type: 'string', description: 'The decision the paper informs. options_analysis.' },
          },
        },
        sections: {
          type: 'array',
          description:
            'Body sections for the section-shaped templates (briefing_note, ' +
            'analysis_summary, governance_paper, status_report, options_analysis). ' +
            'Each section has a heading and content. Plain text, no markdown.',
          items: {
            type: 'object',
            properties: {
              heading:    { type: 'string', description: 'Section heading.' },
              level:      { type: 'integer', enum: [1, 2, 3], description: 'Heading level for the scratch builder only; ignored by templates.' },
              paragraphs: { type: 'array', items: { type: 'string' }, description: 'Body paragraphs. Plain text.' },
              bullets:    { type: 'array', items: { type: 'string' }, description: 'Bullet list items. No bullet character.' },
            },
            required: ['heading'],
          },
        },
        options: {
          type: 'array',
          description: 'Options for options_analysis. Each has a name, description, strengths, weaknesses.',
          items: {
            type: 'object',
            properties: {
              name:        { type: 'string' },
              description: { type: 'string' },
              strengths:   { type: 'array', items: { type: 'string' } },
              weaknesses:  { type: 'array', items: { type: 'string' } },
            },
            required: ['name'],
          },
        },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Attendee names. meeting_notes only.',
        },
        apologies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Apology names. meeting_notes only.',
        },
        agenda_items: {
          type: 'array',
          description: 'Agenda items. meeting_notes only.',
          items: {
            type: 'object',
            properties: {
              topic:      { type: 'string' },
              discussion: { type: 'array', items: { type: 'string' } },
              decisions:  { type: 'array', items: { type: 'string' } },
              actions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    action:   { type: 'string' },
                    owner:    { type: 'string' },
                    due_date: { type: 'string' },
                  },
                  required: ['action'],
                },
              },
            },
            required: ['topic'],
          },
        },
        salutation:      { type: 'string', description: 'Greeting, e.g. "Dear Sarah,". formal_email only.' },
        body_paragraphs: { type: 'array', items: { type: 'string' }, description: 'Email body paragraphs. formal_email only.' },
        signoff:         { type: 'string', description: 'Sign-off, e.g. "Kind regards,". formal_email only.' },
        signature:      { type: 'array', items: { type: 'string' }, description: 'Signature block lines (name, role, organisation, contact). formal_email only.' },
        subtitle:        { type: 'string', description: 'Subtitle for the scratch builder (no template). Ignored by templates.' },
        organisation:    { type: 'string', description: 'Organisation for the scratch builder (no template). Ignored by templates.' },
      },
      required: ['title', 'template'],
    },
  },
];

// Safety net: if Claude forgets to set the template but the title clearly
// describes a briefing note, set it. Mirrors the AHP backstop.
const BRIEFING_NOTE_PATTERN = /\bbriefing\s*note\b/i;

function applyTemplateBackstop(input) {
  if (!input || typeof input !== 'object') return input;
  if (input.template) return input;
  const title = typeof input.title === 'string' ? input.title : '';
  if (BRIEFING_NOTE_PATTERN.test(title)) {
    return { ...input, template: 'briefing_note' };
  }
  return input;
}

// Execute the document tool: build the .docx, upload it, return a download URL.
async function executeCreateWordDocument(rawInput, { userId, sessionId }) {
  const input = applyTemplateBackstop(rawInput);
  const title = (input && input.title) || 'document';

  const buffer = await buildWordDocument(input);
  const filename = safeFilename(title);
  const storagePath = `${userId}/${sessionId}/${filename}`;
  const { signedUrl } = await uploadAndSign(buffer, storagePath, WORD_MIME);

  const message =
    `Document created successfully.\n` +
    `Title: ${title}\n` +
    `Filename: ${filename}\n` +
    `Template: ${input && input.template ? input.template : 'none (scratch build)'}\n` +
    `Download URL: ${signedUrl}\n\n` +
    `Provide this URL to the user as a Markdown link, formatted exactly like ` +
    `[${filename}](${signedUrl}), then briefly confirm the document is ready ` +
    `and offer revisions. Keep the surrounding text short.`;

  return { signedUrl, filename, message };
}

// Non-streaming tool loop. Returns the final assistant text plus, if a
// document was created, its URL and filename.
async function runWithTools({ baseParams, context, maxRounds = 3 }) {
  let currentMessages = baseParams.messages;
  let documentUrl = null;
  let documentFilename = null;

  for (let round = 0; round < maxRounds; round++) {
    const response = await anthropic.messages.create({
      ...baseParams,
      messages: currentMessages,
    });

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      return { text, documentUrl, documentFilename };
    }

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const toolUse of toolUseBlocks) {
      if (toolUse.name === 'create_word_document') {
        try {
          const result = await executeCreateWordDocument(toolUse.input, context);
          documentUrl = result.signedUrl;
          documentFilename = result.filename;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result.message,
          });
        } catch (err) {
          console.error('create_word_document error:', err);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            is_error: true,
            content: `Failed to create the document: ${err.message}`,
          });
        }
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Unknown tool: ${toolUse.name}`,
        });
      }
    }

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ];
  }

  return {
    text:
      'I was not able to finish creating the document within the allowed number ' +
      'of steps. Please try again, or ask me to simplify the document.',
    documentUrl,
    documentFilename,
  };
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

  // Document creation guidance (PROF-1 Phase C).
  prompt +=
    '\n\n## Document Creation\n' +
    'You can create downloadable Microsoft Word documents using the ' +
    'create_word_document tool. Use it when the user requests a finished, ' +
    'formal deliverable they would download and edit. Do not use it for short ' +
    'answers, explanations, or casual discussion. When the request is ' +
    'ambiguous, briefly ask the user whether they want a document before ' +
    'calling the tool. After the tool runs you receive a download URL which ' +
    'you must surface to the user as a Markdown link in your reply.\n\n' +
    'Match the template to the request: briefing_note (recipient-directed ' +
    'brief, always use this for briefing notes), analysis_summary (self-driven ' +
    'analysis), governance_paper (council/committee paper for noting, ' +
    'endorsement, or decision), status_report (periodic update over a defined ' +
    'period), meeting_notes (minutes with attendees, agenda items, decisions, ' +
    'actions), options_analysis (comparison of options against criteria), and ' +
    'formal_email (salutation, body, sign-off, signature). Populate metadata ' +
    'from the user profile where natural and ask for fields you cannot infer ' +
    'rather than inventing them.';

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
  // LIB-8: project documents get the full content window (up to the upload
  // cap of 50,000 characters), not the 8,000-character snippet used for the
  // general library. Long contracts often place admin matter (lodgement
  // details, contact tables, schedules) in their first 8,000 characters, with
  // the substantive scope text past that. The general library stays at 8,000
  // because those rows are short and we want the most relevant snippet.
  if (libraryDocs && libraryDocs.length > 0) {
    prompt += `\n\n## Relevant Frameworks, Guidance and Project Documents`;
    libraryDocs.forEach(d => {
      prompt += `\n\n### ${d.title}`;
      const isProjectDoc = project && d.project_id && d.project_id === project.id;
      const contentLimit = isProjectDoc ? 50000 : 8000;
      prompt += `\n${d.content.slice(0, contentLimit)}`;
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
    // 4. SVR-5: track whether a fresh session was created so we can fire title
    //    generation later. The crude slice-of-message title set at creation is
    //    kept as a fallback in case AI title generation fails.
    let activeSessionId = null;
    let isNewSession = false;

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
      isNewSession = true;
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

    // LIB-7: Always-include project-scoped retrieval.
    // Single-embedding documents (e.g. a 50,000-character contract uploaded
    // through the library upload) can be too semantically diffuse to clear
    // PROJECT_THRESHOLD for vague questions like "what are the key risks
    // in this contract". To guarantee that documents deliberately loaded
    // into a project are always available when that project is active, do
    // a direct fetch by project_id (no similarity gate) and merge those
    // rows in alongside the similarity-based hits. The similarity call is
    // retained so that any nuance-driven matches still come through.
    //
    // LIB-7 revision: this only holds while the project has few enough rows
    // to return them ALL. Chunked ingestion (a long contract split into forty
    // or more rows) breaks the guarantee, because a capped fetch then returns
    // an arbitrary subset that fills the prompt with unrelated chunks and
    // pushes out the genuinely relevant ones. So count first, and only take
    // the direct-fetch path when the whole set fits inside the cap. Above the
    // cap, similarity retrieval (PROJECT_MATCH_COUNT, now 10) does the work.
    let alwaysIncludedProjectDocs = [];
    let projectScopedDocs = [];
    if (project_id) {
      const { count: projectDocCount, error: countErr } = await supabase
        .from('library_documents')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project_id);

      if (countErr) {
        console.error('Project-docs count error:', countErr);
      } else if (projectDocCount > 0 && projectDocCount <= PROJECT_DIRECT_INCLUDE_LIMIT) {
        const { data: directProjectDocs, error: directErr } = await supabase
          .from('library_documents')
          .select('id, title, category, content, source_url, project_id')
          .eq('project_id', project_id)
          .order('title', { ascending: true })
          .limit(PROJECT_DIRECT_INCLUDE_LIMIT);
        if (directErr) {
          console.error('Direct project-docs fetch error:', directErr);
        } else {
          alwaysIncludedProjectDocs = directProjectDocs || [];
        }
      } else if (projectDocCount > PROJECT_DIRECT_INCLUDE_LIMIT) {
        console.log(
          'LIB-7: project ' + project_id + ' holds ' + projectDocCount +
          ' library rows, above the always-include limit of ' + PROJECT_DIRECT_INCLUDE_LIMIT +
          '. Using similarity retrieval only.'
        );
      }

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

    // Dedup by id. Always-included project docs go first so they win the
    // dedup when the same id also comes back from the similarity calls.
    const seen = new Set();
    const libraryDocs = [];
    for (const d of [...(alwaysIncludedProjectDocs || []), ...(projectScopedDocs || []), ...(libraryHits || [])]) {
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

    // PROF-1 Phase C: run through the non-streaming tool loop so Claude can
    // create documents when asked. For ordinary chat (no tool call) this
    // returns on the first round with documentUrl null.
    const { text: responseText, documentUrl, documentFilename } = await runWithTools({
      baseParams: {
        model: 'claude-sonnet-4-6',
        max_tokens: 8192, // raised from 2048 so full documents fit in one tool call
        system: systemPrompt,
        tools: TOOLS,
        messages: messagesForClaude,
      },
      context: { userId, sessionId: activeSessionId },
    });

    const responseHtml = toHtml(responseText);

    const { error: assistantInsertError } = await supabase.from('messages').insert({
      session_id: activeSessionId,
      role: 'assistant',
      content: responseText,
    });
    if (assistantInsertError) {
      console.error('Failed to save assistant message:', assistantInsertError);
    }

    // =========================================================================
    // SVR-5: trigger automatic title generation for newly created sessions.
    // =========================================================================
    // Fire-and-forget. The main response continues without waiting for the
    // title to be generated. The promise is intentionally not awaited; the
    // .catch handler logs any failure to Render logs without affecting the
    // response that has already been built. If this fails entirely, the
    // crude slice-of-message title set during session creation remains
    // in place as a fallback.
    if (isNewSession && responseText && responseText.trim().length > 0) {
      generateAndSaveTitle(activeSessionId, message, responseText)
        .catch(err => console.error('Background title generation error:', err.message));
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
      document_url: documentUrl,           // PROF-1 Phase C: null unless a document was created
      document_filename: documentFilename, // PROF-1 Phase C: null unless a document was created
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
    const allowed = ['role', 'service_area', 'goals', 'preferences', 'artefact_preference', 'high_scrutiny', 'default_stance', 'length_default', 'tone_register', 'uncertainty_handling', 'output_density', 'next_steps', 'clarification_style', 'context_input', 'primary_use', 'refinement_style', 'expertise_level'];
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
  const module_id = req.query.module_id || req.query.moduleId;
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });

  try {
    const user = await getUserByEmail(email);
    let query = supabase
      .from('projects')
      .select('id, name, description, objectives, custom_instructions, parent_id, artefact_preference, high_scrutiny, module_id, created_at')
      .eq('user_id', user.id)
      .is('archived_at', null);
    // When a domain (module) is supplied, show only that domain's projects.
    if (module_id) query = query.eq('module_id', module_id);
    const { data, error } = await query.order('created_at', { ascending: false });
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
  const custom_instructions = body.custom_instructions;
  const parent_id = body.parent_id || body.parentId;

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
        custom_instructions: custom_instructions || null,
        parent_id: parent_id || null,
      })
      .select('id, name, description, objectives, custom_instructions, parent_id, artefact_preference, high_scrutiny, module_id, created_at')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('CreateProject error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- PATCH /api/copilot/projects/:id (API-8: update project settings) ----
// Lets PRJ-6 (the project settings page) save background, objectives,
// custom AI instructions and the always-high-scrutiny flag per project.
// Only these four fields are writable; ownership is enforced via user_id.
router.patch('/projects/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const email = body.email;

  if (!email) {
    return res.status(400).json({ error: 'email is required in the body.' });
  }

  // Allow-list. Only include a field when the key is actually present in the
  // body, so a partial save never blanks out the fields it did not send.
  const updates = {};
  if ('description' in body) updates.description = body.description;
  if ('objectives' in body) updates.objectives = body.objectives;
  if ('custom_instructions' in body) updates.custom_instructions = body.custom_instructions;
  if ('high_scrutiny' in body) updates.high_scrutiny = body.high_scrutiny;
  if ('name' in body) updates.name = body.name;
  // parent_id is a uuid column: an empty string from the client must become null,
  // otherwise Postgres rejects it with "invalid input syntax for type uuid".
  if ('parent_id' in body) updates.parent_id = body.parent_id || null;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided.' });
  }

  try {
    const user = await getUserByEmail(email);

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, name, description, objectives, custom_instructions, parent_id, artefact_preference, high_scrutiny, module_id, created_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Project not found or not owned by user.' });
    res.json(data);
  } catch (err) {
    console.error('UpdateProject error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/copilot/projects/archived?email=X ----
// NOTE: this must be declared before any '/projects/:id' style routes so that
// the literal 'archived' segment is not captured as an :id parameter.
router.get('/projects/archived', async (req, res) => {
  const { email } = req.query;
  const module_id = req.query.module_id || req.query.moduleId;
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });

  try {
    const user = await getUserByEmail(email);
    let query = supabase
      .from('projects')
      .select('id, name, description, objectives, custom_instructions, parent_id, artefact_preference, high_scrutiny, module_id, created_at, archived_at')
      .eq('user_id', user.id)
      .not('archived_at', 'is', null);
    if (module_id) query = query.eq('module_id', module_id);
    const { data, error } = await query.order('archived_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('GetArchivedProjects error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- PATCH /api/copilot/projects/:id/archive ----
router.patch('/projects/:id/archive', async (req, res) => {
  const { id } = req.params;
  const email = (req.body || {}).email;
  if (!email) return res.status(400).json({ error: 'email is required in the body.' });

  try {
    const user = await getUserByEmail(email);
    const { data, error } = await supabase
      .from('projects')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, name, archived_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Project not found or not owned by user.' });
    res.json({ success: true, project: data });
  } catch (err) {
    console.error('ArchiveProject error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- PATCH /api/copilot/projects/:id/restore ----
router.patch('/projects/:id/restore', async (req, res) => {
  const { id } = req.params;
  const email = (req.body || {}).email;
  if (!email) return res.status(400).json({ error: 'email is required in the body.' });

  try {
    const user = await getUserByEmail(email);
    const { data, error } = await supabase
      .from('projects')
      .update({ archived_at: null })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, name, archived_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Project not found or not owned by user.' });
    res.json({ success: true, project: data });
  } catch (err) {
    console.error('RestoreProject error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- DELETE /api/copilot/projects/:id?email=X ----
router.delete('/projects/:id', async (req, res) => {
  const { id } = req.params;
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });

  try {
    const user = await getUserByEmail(email);
    const { data: existing } = await supabase
      .from('projects')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Project not found or not owned by user.' });

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DeleteProject error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/copilot/sessions?email=X&project_id=Y ----
router.get('/sessions', async (req, res) => {
  const { email } = req.query;
  const project_id = req.query.project_id || req.query.projectId;
  const module_id = req.query.module_id || req.query.moduleId;
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

    // When a domain (module) is supplied, restrict sessions to that domain's
    // projects (sessions follow their project's domain).
    if (module_id && !project_id) {
      const { data: domainProjects, error: dpErr } = await supabase
        .from('projects')
        .select('id')
        .eq('user_id', user.id)
        .eq('module_id', module_id);
      if (dpErr) throw dpErr;
      const ids = (domainProjects || []).map(p => p.id);
      // If the domain has no projects, there are no sessions to show.
      if (ids.length === 0) return res.json([]);
      query = query.in('project_id', ids);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/copilot/sessions/archived?email=X ----
// Declared before '/sessions/:id/...' routes so 'archived' is not read as an :id.
router.get('/sessions/archived', async (req, res) => {
  const { email } = req.query;
  const module_id = req.query.module_id || req.query.moduleId;
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });

  try {
    const user = await getUserByEmail(email);
    let query = supabase
      .from('sessions')
      .select('id, title, summary, project_id, created_at, archived_at')
      .eq('user_id', user.id)
      .not('archived_at', 'is', null);

    // Restrict archived sessions to the active domain's projects.
    if (module_id) {
      const { data: domainProjects, error: dpErr } = await supabase
        .from('projects')
        .select('id')
        .eq('user_id', user.id)
        .eq('module_id', module_id);
      if (dpErr) throw dpErr;
      const ids = (domainProjects || []).map(p => p.id);
      if (ids.length === 0) return res.json([]);
      query = query.in('project_id', ids);
    }

    const { data, error } = await query.order('archived_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('GetArchivedSessions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- PATCH /api/copilot/sessions/:id/archive ----
router.patch('/sessions/:id/archive', async (req, res) => {
  const { id } = req.params;
  const email = (req.body || {}).email;
  if (!email) return res.status(400).json({ error: 'email is required in the body.' });

  try {
    const user = await getUserByEmail(email);
    const { data, error } = await supabase
      .from('sessions')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, title, archived_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Session not found or not owned by user.' });
    res.json({ success: true, session: data });
  } catch (err) {
    console.error('ArchiveSession error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- PATCH /api/copilot/sessions/:id/restore ----
router.patch('/sessions/:id/restore', async (req, res) => {
  const { id } = req.params;
  const email = (req.body || {}).email;
  if (!email) return res.status(400).json({ error: 'email is required in the body.' });

  try {
    const user = await getUserByEmail(email);
    const { data, error } = await supabase
      .from('sessions')
      .update({ archived_at: null })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, title, archived_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Session not found or not owned by user.' });
    res.json({ success: true, session: data });
  } catch (err) {
    console.error('RestoreSession error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- DELETE /api/copilot/sessions/:id?email=X ----
router.delete('/sessions/:id', async (req, res) => {
  const { id } = req.params;
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });

  try {
    const user = await getUserByEmail(email);
    const { data: existing } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Session not found or not owned by user.' });

    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DeleteSession error:', err);
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

// =============================================================================
// MEMORY MANAGEMENT (MEM-1)
// Pinned notes are rows in session_embeddings whose content starts with the
// '[PINNED NOTE] ' prefix (see routes/pinMemory.js). They link to a project
// through their session's project_id. Auto-generated session summaries also
// live in session_embeddings but do NOT carry the prefix, so they are excluded.
// =============================================================================

const PINNED_PREFIX = '[PINNED NOTE] ';

// ---- GET /api/copilot/memories?email=X&project_id=Y ----
// Lists pinned notes for a project. Returns the row id, the note text (with the
// prefix stripped for display), and created_at.
router.get('/memories', async (req, res) => {
  const { email } = req.query;
  const project_id = req.query.project_id || req.query.projectId;
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });
  if (!project_id) return res.status(400).json({ error: 'project_id query parameter is required.' });

  try {
    const user = await getUserByEmail(email);

    // Find the sessions that belong to this project for this user.
    const { data: sessions, error: sessErr } = await supabase
      .from('sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('project_id', project_id);
    if (sessErr) throw sessErr;

    const sessionIds = (sessions || []).map(s => s.id);
    if (sessionIds.length === 0) return res.json([]);

    // Pinned notes for those sessions.
    const { data: rows, error: rowErr } = await supabase
      .from('session_embeddings')
      .select('id, content, session_id')
      .in('session_id', sessionIds)
      .like('content', PINNED_PREFIX + '%');
    if (rowErr) throw rowErr;

    const memories = (rows || []).map(r => ({
      id: r.id,
      content: r.content.startsWith(PINNED_PREFIX) ? r.content.slice(PINNED_PREFIX.length) : r.content,
      session_id: r.session_id,
    }));

    res.json(memories);
  } catch (err) {
    console.error('GetMemories error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- PATCH /api/copilot/memories/:id ----
// Updates a pinned note's text and re-embeds it (the embedding must match the
// new text). Body: { email, content }. The prefix is re-applied server-side.
router.patch('/memories/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const email = body.email;
  const content = body.content;
  if (!email) return res.status(400).json({ error: 'email is required in the body.' });
  if (!content || !content.trim()) return res.status(400).json({ error: 'content is required.' });

  try {
    const user = await getUserByEmail(email);

    // Verify the note belongs to a session owned by this user before editing.
    const { data: row, error: rowErr } = await supabase
      .from('session_embeddings')
      .select('id, session_id')
      .eq('id', id)
      .maybeSingle();
    if (rowErr) throw rowErr;
    if (!row) return res.status(404).json({ error: 'Memory not found.' });

    const { data: sess } = await supabase
      .from('sessions')
      .select('user_id')
      .eq('id', row.session_id)
      .maybeSingle();
    if (!sess || sess.user_id !== user.id) {
      return res.status(404).json({ error: 'Memory not found or not owned by user.' });
    }

    const newContent = PINNED_PREFIX + content.trim();
    const embedding = await embed(newContent);

    const { error: updErr } = await supabase
      .from('session_embeddings')
      .update({ content: newContent, embedding })
      .eq('id', id);
    if (updErr) throw updErr;

    res.json({ success: true });
  } catch (err) {
    console.error('UpdateMemory error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- DELETE /api/copilot/memories/:id?email=X ----
router.delete('/memories/:id', async (req, res) => {
  const { id } = req.params;
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });

  try {
    const user = await getUserByEmail(email);

    // Verify ownership through the session before deleting.
    const { data: row } = await supabase
      .from('session_embeddings')
      .select('id, session_id')
      .eq('id', id)
      .maybeSingle();
    if (!row) return res.status(404).json({ error: 'Memory not found.' });

    const { data: sess } = await supabase
      .from('sessions')
      .select('user_id')
      .eq('id', row.session_id)
      .maybeSingle();
    if (!sess || sess.user_id !== user.id) {
      return res.status(404).json({ error: 'Memory not found or not owned by user.' });
    }

    const { error } = await supabase
      .from('session_embeddings')
      .delete()
      .eq('id', id);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('DeleteMemory error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;