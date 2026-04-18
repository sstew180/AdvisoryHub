const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const PDFParser = require('pdf2json');
const mammoth = require('mammoth');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const TRIGGER_PHRASES = [
  { prefix: 'remember that ', strip: 'remember that ' },
  { prefix: 'remember: ', strip: 'remember: ' },
  { prefix: 'note: ', strip: 'note: ' },
  { prefix: 'note that ', strip: 'note that ' },
  { prefix: 'capture: ', strip: 'capture: ' },
  { prefix: 'capture this: ', strip: 'capture this: ' },
];

function detectTrigger(text) {
  const lower = text.toLowerCase().trim();
  for (const t of TRIGGER_PHRASES) {
    if (lower.startsWith(t.prefix)) {
      return text.slice(t.strip.length).trim();
    }
  }
  return null;
}

const RULE_DEFINITIONS = {
  no_abstract_concepts: 'Do not introduce any concept without anchoring it to a specific data point, document, or recorded example. If a paragraph reads like a textbook definition, rewrite it.',
  movement_verbs_evidence: 'If you use words such as "shifted", "evolved", "accelerated", or "embedded", you must immediately cite what specifically changed and where it is recorded.',
  traceable_claims: 'Every major claim must be traceable to a document, metric, or meeting. If it cannot be traced, label it as commentary.',
  show_sequence: 'Do not compress cause and effect into a single sentence. Show the steps in order. Replace "this led to" with documented sequence.',
  no_rhetorical_contrasts: 'Do not use balanced rhetorical contrast constructions such as "not X but Y" or "less about X and more about Y". These patterns sound polished but substitute structure for substance.',
  no_three_part_lists: 'Do not use three-part rhetorical lists (e.g. "clarity, consistency, and commitment") unless each item is tied to a measurable action or specific evidence.',
  metric_per_paragraph: 'In analytical responses, include at least one specific metric, figure, or documented fact per paragraph. Do not allow paragraphs that are entirely interpretive.',
  no_em_dashes: 'Do not use em dashes. Use commas, colons, or restructure the sentence.',
  no_slogans: 'Do not end paragraphs or sections with motivational or slogan-like language. End with operational detail instead.',
  no_buzzwords: 'Do not use the following words: leverage, optimise, unlock, transformative, holistic, ecosystem, synergy, embed, accelerate. Replace with specific actions or numbers.',
  plain_english: 'Use plain English throughout. Avoid jargon unless it is the precise correct term.',
  active_voice: 'Use active voice. Avoid passive constructions where the actor is unclear.',
  short_sentences: 'Keep sentences under 20 words where possible.',
  no_nominalisation: 'Avoid nominalisation -- turning verbs into nouns. Write "we assessed" not "an assessment was conducted". Write "the committee decided" not "a decision was made by the committee".',
  no_hedging: 'Avoid excessive hedging language such as "it could be argued", "one might suggest", "it is possible that". State positions directly or flag uncertainty explicitly.',
  adversarial_review: 'After drafting, internally critique the response for unrealistic assumptions, unsupported claims, and logical gaps. Surface these to the user.',
  expose_assumptions: 'Before expanding any plan or argument, list the assumptions embedded in it and note what would happen if each proved false.',
  no_flattery: 'Do not include conversational praise or validation. No "that\'s a great question", "you\'re absolutely right", or similar phrases. Maintain analytical neutrality.',
  prove_it: 'Do not allow unsupported major claims. If evidence is absent, label it explicitly as "no supporting data currently available".',
  model_failure_modes: 'For every proposed action or recommendation, include at least one way it could fail and the earliest warning signal.',
  no_motive_speculation: 'Describe decisions and actions only. Do not speculate about what people were thinking or feeling.',
  cite_qao: 'When making recommendations about risk management, internal audit, or governance, cite the relevant QAO Better Practice Guide or Queensland Audit Office guidance where it applies.',
  flag_legal_boundary: 'If a response touches on matters that may require legal, insurance, or specialist professional advice, flag this explicitly at the end of the response.',
  multi_role_check: 'For high-stakes recommendations, consider the perspective of at least two stakeholders -- e.g. how would the CFO and the external auditor each view this recommendation.',
  lead_with_answer: 'State the recommendation or conclusion first. Do not bury it after background.',
  no_bullets_default: 'Use prose paragraphs by default. Only use bullet points if the user explicitly asks for a list.',
  end_operational: 'End sections with a concrete operational detail, not a rhetorical closure or summary sentence.',
  no_preamble: 'Do not begin responses with preamble that restates the question or explains what you are about to do. Start directly with the substance.',
  no_summary_ending: 'Do not end responses with a summary paragraph that repeats what was just said. End with a next step, a question, or a specific action.',
  confirm_artefact: 'If the user asks for a document or structured output, confirm the document type and intended audience in one sentence before producing it.',
};

const LENGTH_INSTRUCTIONS = {
  brief: 'Keep the response to 2-3 short paragraphs maximum.',
  standard: 'Keep the response to roughly one page -- 4-6 paragraphs.',
  detailed: 'Provide a full, detailed response with as much depth as needed.',
};

const FORMAT_INSTRUCTIONS = {
  prose: 'Write in flowing prose paragraphs. No bullet points or numbered lists.',
  structured: 'Use clear headings and structured sections to organise the response.',
  bullets: 'Use bullet points or numbered lists as the primary format.',
  table: 'Present the information as a table where possible.',
};

const DEPTH_INSTRUCTIONS = {
  summary: 'Provide a high-level summary only. Do not go into detail.',
  analysis: 'Provide analysis with reasoning, not just facts.',
  full: 'Provide full analysis with specific recommendations and next steps.',
  critical: 'Provide full analysis plus an adversarial critique -- identify assumptions, gaps, and risks.',
};

function buildRulesBlock(profileRules, projectRules, promptOverrides) {
  const profileActive = Array.isArray(profileRules) ? profileRules : [];
  const projectOverrides = Array.isArray(projectRules) ? projectRules : [];
  let active = new Set(profileActive);
  for (const rule of projectOverrides) {
    if (rule.endsWith(':on')) active.add(rule.replace(':on', ''));
    else if (rule.endsWith(':off')) active.delete(rule.replace(':off', ''));
    else active.add(rule);
  }
  const overrides = promptOverrides && typeof promptOverrides === 'object' ? promptOverrides : {};
  for (const [id, state] of Object.entries(overrides)) {
    if (state === 'on') active.add(id);
    else if (state === 'off') active.delete(id);
  }
  if (active.size === 0) return '';
  const instructions = [...active]
    .map(id => RULE_DEFINITIONS[id])
    .filter(Boolean)
    .map(rule => '- ' + rule)
    .join('\n');
  return '\n\nWRITING RULES (apply to every response):\n' + instructions;
}

function buildFormatBlock(formatControls) {
  if (!formatControls) return '';
  const parts = [];
  if (formatControls.length && LENGTH_INSTRUCTIONS[formatControls.length])
    parts.push(LENGTH_INSTRUCTIONS[formatControls.length]);
  if (formatControls.format && FORMAT_INSTRUCTIONS[formatControls.format])
    parts.push(FORMAT_INSTRUCTIONS[formatControls.format]);
  if (formatControls.depth && DEPTH_INSTRUCTIONS[formatControls.depth])
    parts.push(DEPTH_INSTRUCTIONS[formatControls.depth]);
  if (parts.length === 0) return '';
  return '\n\nFORMAT INSTRUCTION (applies to this response only):\n' +
    parts.map(p => '- ' + p).join('\n');
}

function mergeLibraryDocs(globalDocs, projectDocs) {
  if (!projectDocs || projectDocs.length === 0) return globalDocs || [];
  const projectTitles = new Set(projectDocs.map(d => d.title));
  const filtered = (globalDocs || []).filter(d => !projectTitles.has(d.title));
  return [...projectDocs, ...filtered];
}

function sendStatus(res, message) {
  res.write('data: ' + JSON.stringify({ status: message }) + '\n\n');
}

function extractPdfText(buffer) {
  return new Promise((resolve) => {
    try {
      const pdfParser = new PDFParser(null, 1);
      pdfParser.on('pdfParser_dataReady', (data) => {
        try {
          const text = data.Pages.map(page =>
            page.Texts.map(t => t.R.map(r => decodeURIComponent(r.T)).join('')).join(' ')
          ).join('\n\n');
          resolve(text.trim().length > 0 ? text : null);
        } catch (e) {
          console.error('PDF text assembly error:', e.message);
          resolve(null);
        }
      });
      pdfParser.on('pdfParser_dataError', (err) => {
        console.error('PDF parse error:', err.parserError);
        resolve(null);
      });
      pdfParser.parseBuffer(buffer);
    } catch (e) {
      console.error('PDF parser init error:', e.message);
      resolve(null);
    }
  });
}

async function extractFileText(file) {
  try {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      return await extractPdfText(file.buffer);
    } else if (file.mimetype.includes('wordprocessingml') || file.originalname.toLowerCase().endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return result.value || null;
    } else {
      return file.buffer.toString('utf-8');
    }
  } catch (err) {
    console.error('File extraction error:', err.message);
    return null;
  }
}

router.post('/', upload.single('file'), async (req, res) => {
  const userId = req.body.userId;
  const sessionId = req.body.sessionId;
  const projectId = req.body.projectId || null;
  const moduleId = req.body.moduleId || null;
  const mode = req.body.mode;
  const ruleOverrides = req.body.ruleOverrides ? JSON.parse(typeof req.body.ruleOverrides === 'string' ? req.body.ruleOverrides : JSON.stringify(req.body.ruleOverrides || {})) : {};
  const formatControls = req.body.formatControls ? JSON.parse(typeof req.body.formatControls === 'string' ? req.body.formatControls : JSON.stringify(req.body.formatControls || {})) : {};
  let messages = JSON.parse(typeof req.body.messages === 'string' ? req.body.messages : JSON.stringify(req.body.messages || {}));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    let attachedFileName = null;
    if (req.file) {
      sendStatus(res, 'Reading attached document');
      const fileText = await extractFileText(req.file);
      attachedFileName = req.file.originalname;
      if (fileText && fileText.trim().length > 0) {
        const truncated = fileText.slice(0, 40000);
        const lastMsg = messages[messages.length - 1];
        messages = [
          ...messages.slice(0, -1),
          { role: 'user', content: `## Attached document: ${attachedFileName}\n\n${truncated}\n\n---\n\n${lastMsg.content}` },
        ];
        res.write('data: ' + JSON.stringify({ attached: attachedFileName }) + '\n\n');
      } else {
        res.write('data: ' + JSON.stringify({ status: 'Could not extract text from ' + attachedFileName + ' -- continuing without it' }) + '\n\n');
        attachedFileName = null;
      }
    }

    sendStatus(res, 'Reading your profile');
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();

    let activeModule = null;
    let activePersona = null;
    if (moduleId) {
      const { data: mod } = await supabase.from('modules').select('*').eq('id', moduleId).single();
      activeModule = mod;
      const { data: persona } = await supabase.from('personas')
        .select('*').eq('user_id', userId).eq('module_id', moduleId).single();
      activePersona = persona;
    }

    let project = null;
    let parentProject = null;
    if (projectId) {
      sendStatus(res, 'Loading project context');
      const { data } = await supabase.from('projects').select('*').eq('id', projectId).single();
      project = data;
      if (project?.parent_id) {
        const { data: parent } = await supabase.from('projects').select('*').eq('id', project.parent_id).single();
        parentProject = parent;
      }
    }

    const userQuery = messages[messages.length - 1].content;
    const queryEmbedding = await embed(userQuery);

    const capturedNote = detectTrigger(userQuery);
    if (capturedNote && sessionId) {
      const noteEmbedding = await embed(capturedNote);
      supabase.from('session_embeddings').insert({
        session_id: sessionId, user_id: userId,
        content: '[AUTO-CAPTURED] ' + capturedNote, embedding: noteEmbedding,
      }).then(() => console.log('Auto-captured note:', capturedNote))
        .catch(err => console.error('Auto-capture error:', err));
    }

    sendStatus(res, 'Searching your memories');
    const { data: memories } = await supabase.rpc('match_sessions', {
      query_embedding: queryEmbedding, match_user_id: userId, match_threshold: 0.7, match_count: 5
    });

    const { data: recentSessions } = await supabase
      .from('sessions').select('id, title, summary, created_at')
      .eq('user_id', userId).not('summary', 'is', null)
      .order('created_at', { ascending: false }).limit(5);

    const activeProjectIds = [
      ...(projectId ? [projectId] : []),
      ...(parentProject ? [parentProject.id] : []),
    ];

    sendStatus(res, 'Fetching relevant frameworks');
    const { data: allLibraryDocs } = await supabase.rpc('match_library', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: 8,
      filter_project_ids: activeProjectIds.length > 0 ? activeProjectIds : null,
    });
    const globalLibraryDocs = (allLibraryDocs || []).filter(
      d => !['Skills', 'Templates', 'Organisation'].includes(d.category)
    );

    let projectLibrarySkills = [];
    let projectLibraryTemplates = [];
    let projectLibraryOrg = [];

    if (activeProjectIds.length > 0 && mode !== 'direct') {
      const { data: junctionLinks } = await supabase
        .from('library_document_projects')
        .select('document_id')
        .in('project_id', activeProjectIds);

      if (junctionLinks && junctionLinks.length > 0) {
        const linkedDocIds = junctionLinks.map(l => l.document_id);
        const { data: projLibDocs } = await supabase
          .from('library_documents')
          .select('id, title, category, content, source_url')
          .in('id', linkedDocIds)
          .eq('default_enabled', true);

        if (projLibDocs) {
          projectLibrarySkills = projLibDocs.filter(d => d.category === 'Skills');
          projectLibraryTemplates = projLibDocs.filter(d => d.category === 'Templates');
          projectLibraryOrg = projLibDocs.filter(d => d.category === 'Organisation');
        }
      }
    }

    let globalSkillDocs = [];
    let globalTemplateDocs = [];
    let globalOrgDocs = [];

    if (mode !== 'direct') {
      sendStatus(res, 'Loading skills and templates');
      const [skillRes, templateRes, orgRes] = await Promise.all([
        supabase.from('library_documents').select('id, title, content')
          .eq('category', 'Skills').eq('default_enabled', true).is('project_id', null),
        supabase.from('library_documents').select('id, title, content')
          .eq('category', 'Templates').eq('default_enabled', true).is('project_id', null),
        supabase.from('library_documents').select('id, title, content')
          .eq('category', 'Organisation').eq('default_enabled', true).is('project_id', null),
      ]);
      const allSkills = skillRes.data || [];
      const allTemplates = templateRes.data || [];
      const allOrg = orgRes.data || [];

      const { data: allJunctionLinks } = await supabase
        .from('library_document_projects')
        .select('document_id')
        .in('document_id', [
          ...allSkills.map(d => d.id),
          ...allTemplates.map(d => d.id),
          ...allOrg.map(d => d.id),
        ]);

      const linkedIds = new Set((allJunctionLinks || []).map(l => l.document_id));
      globalSkillDocs = allSkills.filter(d => !linkedIds.has(d.id));
      globalTemplateDocs = allTemplates.filter(d => !linkedIds.has(d.id));
      globalOrgDocs = allOrg.filter(d => !linkedIds.has(d.id));
    }

    const skillDocs = mergeLibraryDocs(globalSkillDocs, projectLibrarySkills);
    const templateDocs = mergeLibraryDocs(globalTemplateDocs, projectLibraryTemplates);
    const orgDocs = mergeLibraryDocs(globalOrgDocs, projectLibraryOrg);
    const resolvedLibraryDocs = globalLibraryDocs;

    sendStatus(res, 'Pulling your documents');
    const { data: userDocsRaw } = await supabase.rpc('match_user_documents', {
      query_embedding: queryEmbedding, match_user_id: userId, match_threshold: 0.7, match_count: 3,
    });
    const userDocs = userDocsRaw || [];

    const isGuided = mode !== 'direct';

    const baseRules = activePersona?.prompt_rules || profile?.prompt_rules || [];
    const projectRules = project?.prompt_rules || [];
    const parentRules = parentProject?.prompt_rules || [];
    const mergedProjectRules = [...new Set([...parentRules, ...projectRules])];

    console.log('--- RAG context ---');
    console.log('Module:', activeModule ? activeModule.name : 'none (fallback)');
    console.log('Persona:', activePersona ? activePersona.role : 'none');
    console.log('Profile:', profile ? profile.role : 'none');
    console.log('Project:', project ? (parentProject ? parentProject.name + ' > ' + project.name : project.name) : 'none');
    console.log('Memories:', memories ? memories.length : 0);
    console.log('Library docs:', resolvedLibraryDocs.map(d => d.title));
    console.log('Skills:', skillDocs.map(d => d.title));
    console.log('User docs:', userDocs.map(d => d.filename));
    console.log('Attached file:', attachedFileName || 'none');
    console.log('Auto-capture:', capturedNote || 'none');
    console.log('-------------------');

    const systemPrompt = buildSystemPrompt(
      profile, activeModule, activePersona,
      project, parentProject, memories, recentSessions,
      resolvedLibraryDocs, skillDocs, templateDocs, orgDocs,
      userDocs, isGuided, baseRules, mergedProjectRules,
      ruleOverrides, formatControls
    );

    if (capturedNote) {
      res.write('data: ' + JSON.stringify({ autocaptured: capturedNote }) + '\n\n');
    }

    sendStatus(res, 'Responding');

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
    res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
    res.end();
  }
});

function buildSystemPrompt(
  profile, activeModule, activePersona,
  project, parentProject, memories, recentSessions,
  libraryDocs, skillDocs, templateDocs, orgDocs,
  userDocs, isGuided, profileRules, projectRules,
  promptOverrides, formatControls
) {
  const identity = activeModule?.system_prompt_identity ||
    'You are AdvisoryHub, an AI-powered advisory assistant for local government ' +
    'officers in Queensland, Australia. You specialise in Risk, Audit, and Insurance. ' +
    'You provide expert guidance drawing on best practice frameworks, Queensland legislation, ' +
    'and the Queensland Audit Office guidelines. You cite your sources when drawing on ' +
    'retrieved documents. You write clearly and professionally.';

  let p = identity + '\n\n' +
    'TEMPLATE INSTRUCTION: When a template document is available in your context and the user ' +
    'requests a completed document, reproduce the full template structure with every section and ' +
    'field completed using information from the project context, memories, and conversation. ' +
    'Do not summarise the template -- complete it in full with realistic, specific content.\n\n' +
    'SKILLS INSTRUCTION: When skills documents are available in your context, apply the relevant ' +
    'skill approach and structure when responding to related requests. Do not quote the skill ' +
    'document verbatim -- use it to shape your response.';

  // Guided mode: question-first behaviour
  if (isGuided) {
    p += '\n\nCONVERSATIONAL APPROACH (Guided mode):\n' +
      'When the user presents an idea, problem, challenge, or request to prepare or present something, ' +
      'do NOT immediately produce a document, report, or structured output. ' +
      'Instead, ask 2-3 focused clarifying questions to understand the audience, what success looks like, ' +
      'what objections or constraints exist, and what context is missing. ' +
      'Only move to producing output once you have enough specific information to make it grounded and relevant. ' +
      'Ask your questions as a short conversational paragraph -- not a bulleted list. ' +
      'If the user has already provided sufficient context, or explicitly asks you to just write something, proceed directly.\n\n' +
      'Ask first when the user says things like: "help me present this to my boss", "draft a briefing note on X", ' +
      '"I need to write a report about Y", "how do I approach Z", "I have this idea". ' +
      'Answer directly when: the user asks a factual question, asks for an explanation, ' +
      'is following up in an ongoing conversation, or says "just write it" or "go ahead".';
  }

  p += buildRulesBlock(profileRules, projectRules, promptOverrides);
  p += buildFormatBlock(formatControls);

  const name = profile?.first_name
    ? profile.first_name + (profile.last_name ? ' ' + profile.last_name : '')
    : null;
  const role = activePersona?.role || profile?.role;
  const serviceArea = activePersona?.service_area || profile?.service_area;
  const organisation = activePersona?.organisation || profile?.organisation;
  const goals = activePersona?.goals || profile?.goals;
  const preferences = activePersona?.preferences || profile?.preferences;
  const highScrutiny = activePersona?.high_scrutiny || profile?.high_scrutiny;

  if (name || role || serviceArea || organisation || goals) {
    p += '\n\n## User Profile';
    if (name) p += '\nName: ' + name;
    if (role) p += '\nRole: ' + role;
    if (serviceArea) p += '\nService Area: ' + serviceArea;
    if (organisation) p += '\nOrganisation: ' + organisation;
    if (goals) p += '\nCurrent objectives: ' + goals;
    if (preferences && isGuided) p += '\nCommunication style: ' + preferences;
    if (highScrutiny) p += '\n\nHIGH SCRUTINY MODE: Flag all assumptions. Note limitations. Recommend verification before use.';
  }

  if (orgDocs && orgDocs.length > 0) {
    p += '\n\n## Organisation Guidelines';
    orgDocs.forEach(d => { p += '\n\n### ' + d.title + '\n' + d.content.slice(0, 4000); });
  }

  if (parentProject) {
    p += '\n\n## Parent Project: ' + parentProject.name;
    if (parentProject.description) p += '\n' + parentProject.description;
    if (parentProject.objectives) p += '\nObjectives: ' + parentProject.objectives;
    if (parentProject.custom_instructions) p += '\nInstructions: ' + parentProject.custom_instructions;
  }

  if (project) {
    const label = parentProject ? '## Active Sub-project: ' + project.name : '## Active Project: ' + project.name;
    p += '\n\n' + label;
    if (project.description) p += '\n' + project.description;
    if (project.objectives) p += '\nObjectives: ' + project.objectives;
    if (project.custom_instructions) p += '\nProject instructions: ' + project.custom_instructions;
    if (project.high_scrutiny) p += '\n\nHIGH SCRUTINY MODE (project): Flag all assumptions. Recommend verification.';
  }

  if (memories && memories.length > 0) {
    p += '\n\n## Relevant Memories and Pinned Notes';
    memories.forEach(m => { p += '\n- ' + m.content; });
  }

  if (recentSessions && recentSessions.length > 0) {
    p += '\n\n## Recent Session Summaries';
    recentSessions.forEach(s => {
      p += '\n\n### ' + (s.title || 'Session') + ' (' + new Date(s.created_at).toLocaleDateString('en-AU') + ')';
      p += '\n' + s.summary;
    });
  }

  if (skillDocs && skillDocs.length > 0) {
    p += '\n\n## Skills and Approaches';
    skillDocs.forEach(d => { p += '\n\n### ' + d.title + '\n' + d.content.slice(0, 2000); });
  }

  if (templateDocs && templateDocs.length > 0) {
    p += '\n\n## Available Templates';
    p += '\nWhen the user asks to complete a template, use the relevant one and fill every field.';
    templateDocs.forEach(d => { p += '\n\n### Template: ' + d.title + '\n' + d.content.slice(0, 4000); });
  }

  if (libraryDocs && libraryDocs.length > 0) {
    p += '\n\n## Relevant Frameworks and Guidance';
    libraryDocs.forEach(d => {
      p += '\n\n### ' + d.title + '\n' + d.content.slice(0, 8000);
      if (d.source_url) p += '\nSource: ' + d.source_url;
    });
  }

  if (userDocs && userDocs.length > 0) {
    p += '\n\n## My Documents';
    userDocs.forEach(d => { p += '\n\n### ' + d.filename + '\n' + d.content.slice(0, 8000); });
  }

  return p;
}

module.exports = router;
