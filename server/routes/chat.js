const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

function buildRulesBlock(profileRules, projectRules, promptOverrides) {
  const profileActive = Array.isArray(profileRules) ? profileRules : [];
  const projectOverrides = Array.isArray(projectRules) ? projectRules : [];
  let active = new Set(profileActive);

  // Apply project overrides -- id:on forces on, id:off forces off
  for (const rule of projectOverrides) {
    if (rule.endsWith(':on')) active.add(rule.replace(':on', ''));
    else if (rule.endsWith(':off')) active.delete(rule.replace(':off', ''));
    else active.add(rule);
  }

  // Apply per-prompt overrides -- highest priority, resets after each send
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

function mergeLibraryDocs(globalDocs, projectDocs) {
  if (!projectDocs || projectDocs.length === 0) return globalDocs || [];
  const projectTitles = new Set(projectDocs.map(d => d.title));
  const filtered = (globalDocs || []).filter(d => !projectTitles.has(d.title));
  return [...projectDocs, ...filtered];
}

router.post('/', async (req, res) => {
  const { userId, sessionId, projectId, messages, mode, ruleOverrides } = req.body;
  try {
    // 1. User profile
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();

    // 2. Project context -- if sub-project, also fetch parent
    let project = null;
    let parentProject = null;
    if (projectId) {
      const { data } = await supabase.from('projects').select('*').eq('id', projectId).single();
      project = data;
      if (project?.parent_id) {
        const { data: parent } = await supabase.from('projects').select('*').eq('id', project.parent_id).single();
        parentProject = parent;
      }
    }

    // 3. Embed current query
    const userQuery = messages[messages.length - 1].content;
    const queryEmbedding = await embed(userQuery);

    // 4. Session memories and pinned notes
    const { data: memories } = await supabase.rpc('match_sessions', {
      query_embedding: queryEmbedding, match_user_id: userId, match_threshold: 0.7, match_count: 5
    });

    // 5. Recent session summaries
    const { data: recentSessions } = await supabase
      .from('sessions')
      .select('id, title, summary, created_at')
      .eq('user_id', userId)
      .not('summary', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5);

    // 6. Global library docs -- vector matched, exclude always-injected categories
    const { data: allLibraryDocs } = await supabase.rpc('match_library', {
      query_embedding: queryEmbedding, match_threshold: 0.7, match_count: 8
    });
    const globalLibraryDocs = (allLibraryDocs || []).filter(
      d => !['Skills', 'Templates', 'Organisation'].includes(d.category)
    );

    // 7. Project-scoped library docs (all categories)
    let projectLibrarySkills = [];
    let projectLibraryTemplates = [];
    let projectLibraryOrg = [];
    let projectLibraryFrameworks = [];

    const activeProjectIds = [
      ...(projectId ? [projectId] : []),
      ...(parentProject ? [parentProject.id] : [])
    ];

    if (activeProjectIds.length > 0 && mode !== 'direct') {
      const { data: projLibDocs } = await supabase
        .from('library_documents')
        .select('id, title, category, content, source_url')
        .in('project_id', activeProjectIds)
        .eq('default_enabled', true);

      if (projLibDocs) {
        projectLibrarySkills = projLibDocs.filter(d => d.category === 'Skills');
        projectLibraryTemplates = projLibDocs.filter(d => d.category === 'Templates');
        projectLibraryOrg = projLibDocs.filter(d => d.category === 'Organisation');
        projectLibraryFrameworks = projLibDocs.filter(
          d => !['Skills', 'Templates', 'Organisation'].includes(d.category)
        );
      }
    }

    // 8. Global skills
    let globalSkillDocs = [];
    if (mode !== 'direct') {
      const { data } = await supabase.from('library_documents').select('id, title, content')
        .eq('category', 'Skills').eq('default_enabled', true).is('project_id', null);
      globalSkillDocs = data || [];
    }

    // 9. Global templates
    let globalTemplateDocs = [];
    if (mode !== 'direct') {
      const { data } = await supabase.from('library_documents').select('id, title, content')
        .eq('category', 'Templates').eq('default_enabled', true).is('project_id', null);
      globalTemplateDocs = data || [];
    }

    // 10. Global organisation docs
    let globalOrgDocs = [];
    if (mode !== 'direct') {
      const { data } = await supabase.from('library_documents').select('id, title, content')
        .eq('category', 'Organisation').eq('default_enabled', true).is('project_id', null);
      globalOrgDocs = data || [];
    }

    // Merge -- project-scoped takes priority over global on same title
    const skillDocs = mergeLibraryDocs(globalSkillDocs, projectLibrarySkills);
    const templateDocs = mergeLibraryDocs(globalTemplateDocs, projectLibraryTemplates);
    const orgDocs = mergeLibraryDocs(globalOrgDocs, projectLibraryOrg);
    const resolvedLibraryDocs = mergeLibraryDocs(globalLibraryDocs, projectLibraryFrameworks);

    // 11. Sub-project documents
    let projectDocs = [];
    if (projectId) {
      const { data } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding, match_project_id: projectId, match_threshold: 0.7, match_count: 3
      });
      projectDocs = data || [];
    }

    // 12. Parent project documents
    let parentDocs = [];
    if (parentProject) {
      const { data } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding, match_project_id: parentProject.id, match_threshold: 0.7, match_count: 2
      });
      parentDocs = data || [];
    }

    const isGuided = mode !== 'direct';
    const profileRules = profile?.prompt_rules || [];
    const projectRules = project?.prompt_rules || [];
    const parentRules = parentProject?.prompt_rules || [];
    const mergedProjectRules = [...new Set([...parentRules, ...projectRules])];

    console.log('--- RAG context ---');
    console.log('Profile:', profile ? profile.role : 'none');
    console.log('Project:', project ? (parentProject ? parentProject.name + ' > ' + project.name : project.name) : 'none');
    console.log('Memories:', memories ? memories.length : 0);
    console.log('Session summaries:', recentSessions ? recentSessions.length : 0);
    console.log('Library docs:', resolvedLibraryDocs.map(d => d.title));
    console.log('Skills:', skillDocs.map(d => d.title));
    console.log('Templates:', templateDocs.map(d => d.title));
    console.log('Org docs:', orgDocs.map(d => d.title));
    console.log('Project docs:', projectDocs.map(d => d.filename));
    console.log('Parent docs:', parentDocs.map(d => d.filename));
    console.log('Active rules:', [...new Set([...profileRules, ...mergedProjectRules])]);
    console.log('Rule overrides:', ruleOverrides || {});
    console.log('-------------------');

    const systemPrompt = buildSystemPrompt(
      profile, project, parentProject, memories, recentSessions,
      resolvedLibraryDocs, skillDocs, templateDocs, orgDocs,
      projectDocs, parentDocs, isGuided, profileRules, mergedProjectRules, ruleOverrides
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

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
    res.status(500).json({ error: err.message });
  }
});

function buildSystemPrompt(profile, project, parentProject, memories, recentSessions, libraryDocs, skillDocs, templateDocs, orgDocs, projectDocs, parentDocs, isGuided, profileRules, projectRules, promptOverrides) {

  let p = 'You are AdvisoryHub, an AI-powered advisory assistant for local government ' +
    'officers in Queensland, Australia. You specialise in Risk, Audit, and Insurance. ' +
    'You provide expert guidance drawing on best practice frameworks, Queensland legislation, ' +
    'and the Queensland Audit Office guidelines. You cite your sources when drawing on ' +
    'retrieved documents. You write clearly and professionally.\n\n' +
    'TEMPLATE INSTRUCTION: When a template document is available in your context and the user ' +
    'requests a completed document, reproduce the full template structure with every section and ' +
    'field completed using information from the project context, memories, and conversation. ' +
    'Do not summarise the template -- complete it in full with realistic, specific content.\n\n' +
    'SKILLS INSTRUCTION: When skills documents are available in your context, apply the relevant ' +
    'skill approach and structure when responding to related requests. Do not quote the skill ' +
    'document verbatim -- use it to shape your response.';

  p += buildRulesBlock(profileRules, projectRules, promptOverrides);

  if (profile) {
    p += '\n\n## User Profile';
    if (profile.role) p += '\nRole: ' + profile.role;
    if (profile.service_area) p += '\nService Area: ' + profile.service_area;
    if (profile.organisation) p += '\nOrganisation: ' + profile.organisation;
    if (profile.goals) p += '\nCurrent objectives: ' + profile.goals;
    if (profile.preferences && isGuided) p += '\nCommunication style: ' + profile.preferences;
    if (profile.artefact_preference) p += '\nDefault output format: ' + profile.artefact_preference;
    if (profile.high_scrutiny) p += '\n\nHIGH SCRUTINY MODE: Flag all assumptions. Note limitations. Recommend verification before use.';
  }

  if (orgDocs && orgDocs.length > 0) {
    p += '\n\n## Organisation Guidelines';
    orgDocs.forEach(d => {
      p += '\n\n### ' + d.title;
      p += '\n' + d.content.slice(0, 4000);
    });
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
    if (project.artefact_preference) p += '\nProject output format: ' + project.artefact_preference;
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
    skillDocs.forEach(d => {
      p += '\n\n### ' + d.title;
      p += '\n' + d.content.slice(0, 2000);
    });
  }

  if (templateDocs && templateDocs.length > 0) {
    p += '\n\n## Available Templates';
    p += '\nThe following templates are available. When the user asks to complete a template, ' +
      'use the relevant one and fill every field using the project context and conversation.';
    templateDocs.forEach(d => {
      p += '\n\n### Template: ' + d.title;
      p += '\n' + d.content.slice(0, 4000);
    });
  }

  if (libraryDocs && libraryDocs.length > 0) {
    p += '\n\n## Relevant Frameworks and Guidance';
    libraryDocs.forEach(d => {
      p += '\n\n### ' + d.title;
      p += '\n' + d.content.slice(0, 8000);
      if (d.source_url) p += '\nSource: ' + d.source_url;
    });
  }

  if (projectDocs && projectDocs.length > 0) {
    p += '\n\n## ' + (parentProject ? 'Sub-project Documents' : 'Project Documents');
    projectDocs.forEach(d => {
      p += '\n\n### ' + d.filename;
      p += '\n' + d.content.slice(0, 8000);
    });
  }

  if (parentDocs && parentDocs.length > 0) {
    p += '\n\n## Parent Project Documents';
    parentDocs.forEach(d => {
      p += '\n\n### ' + d.filename;
      p += '\n' + d.content.slice(0, 8000);
    });
  }

  return p;
}

module.exports = router;