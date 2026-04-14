const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Rule definitions -- each rule has an id and the instruction injected into the system prompt
const RULE_DEFINITIONS = {
  // Grounding
  no_abstract_concepts: 'Do not introduce any concept without anchoring it to a specific data point, document, or recorded example. If a paragraph reads like a textbook definition, rewrite it.',
  movement_verbs_evidence: 'If you use words such as "shifted", "evolved", "accelerated", or "embedded", you must immediately cite what specifically changed and where it is recorded.',
  traceable_claims: 'Every major claim must be traceable to a document, metric, or meeting. If it cannot be traced, label it as commentary.',
  show_sequence: 'Do not compress cause and effect into a single sentence. Show the steps in order. Replace "this led to" with documented sequence.',
  // Tone and style
  no_em_dashes: 'Do not use em dashes. Use commas, colons, or restructure the sentence.',
  no_slogans: 'Do not end paragraphs or sections with motivational or slogan-like language. End with operational detail instead.',
  no_buzzwords: 'Do not use the following words: leverage, optimise, unlock, transformative, holistic, ecosystem, synergy, embed, accelerate. Replace with specific actions or numbers.',
  plain_english: 'Use plain English throughout. Avoid jargon unless it is the precise correct term.',
  active_voice: 'Use active voice. Avoid passive constructions where the actor is unclear.',
  short_sentences: 'Keep sentences under 20 words where possible.',
  // Analytical rigour
  adversarial_review: 'After drafting, internally critique the response for unrealistic assumptions, unsupported claims, and logical gaps. Surface these to the user.',
  expose_assumptions: 'Before expanding any plan or argument, list the assumptions embedded in it and note what would happen if each proved false.',
  no_flattery: 'Do not include conversational praise or validation. No "that\'s a great question", "you\'re absolutely right", or similar phrases. Maintain analytical neutrality.',
  prove_it: 'Do not allow unsupported major claims. If evidence is absent, label it explicitly as "no supporting data currently available".',
  model_failure_modes: 'For every proposed action or recommendation, include at least one way it could fail and the earliest warning signal.',
  no_motive_speculation: 'Describe decisions and actions only. Do not speculate about what people were thinking or feeling.',
  // Output format
  lead_with_answer: 'State the recommendation or conclusion first. Do not bury it after background.',
  no_bullets_default: 'Use prose paragraphs by default. Only use bullet points if the user explicitly asks for a list.',
  end_operational: 'End sections with a concrete operational detail, not a rhetorical closure or summary sentence.',
};

function buildRulesBlock(profileRules, projectRules) {
  const profileActive = Array.isArray(profileRules) ? profileRules : [];
  const projectActive = Array.isArray(projectRules) ? projectRules : [];

  // Merge -- project rules extend profile rules, duplicates deduplicated
  const allActive = [...new Set([...profileActive, ...projectActive])];
  if (allActive.length === 0) return '';

  const instructions = allActive
    .map(id => RULE_DEFINITIONS[id])
    .filter(Boolean)
    .map(rule => '- ' + rule)
    .join('\n');

  return '\n\nWRITING RULES (apply to every response):\n' + instructions;
}

router.post('/', async (req, res) => {
  const { userId, sessionId, projectId, messages, mode } = req.body;
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

    // 4. Session memories and pinned notes (vector-matched)
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

    // 6. Library docs -- vector matched, exclude always-injected categories
    const { data: allLibraryDocs } = await supabase.rpc('match_library', {
      query_embedding: queryEmbedding, match_threshold: 0.7, match_count: 8
    });
    const resolvedLibraryDocs = (allLibraryDocs || []).filter(
      d => !['Skills', 'Templates', 'Organisation'].includes(d.category)
    );

    // 7. Skills -- always inject all in Guided mode
    let skillDocs = [];
    if (mode !== 'direct') {
      const { data } = await supabase.from('library_documents').select('id, title, content')
        .eq('category', 'Skills').eq('default_enabled', true);
      skillDocs = data || [];
    }

    // 8. Templates -- always inject all in Guided mode
    let templateDocs = [];
    if (mode !== 'direct') {
      const { data } = await supabase.from('library_documents').select('id, title, content')
        .eq('category', 'Templates').eq('default_enabled', true);
      templateDocs = data || [];
    }

    // 9. Organisation docs -- always inject all in Guided mode
    let orgDocs = [];
    if (mode !== 'direct') {
      const { data } = await supabase.from('library_documents').select('id, title, content')
        .eq('category', 'Organisation').eq('default_enabled', true);
      orgDocs = data || [];
    }

    // 10. Sub-project documents
    let projectDocs = [];
    if (projectId) {
      const { data } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding, match_project_id: projectId, match_threshold: 0.7, match_count: 3
      });
      projectDocs = data || [];
    }

    // 11. Parent project documents
    let parentDocs = [];
    if (parentProject) {
      const { data } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding, match_project_id: parentProject.id, match_threshold: 0.7, match_count: 2
      });
      parentDocs = data || [];
    }

    const isGuided = mode !== 'direct';

    // Build active rules -- profile base, project extends
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
    console.log('-------------------');

    const systemPrompt = buildSystemPrompt(
      profile, project, parentProject, memories, recentSessions,
      resolvedLibraryDocs, skillDocs, templateDocs, orgDocs,
      projectDocs, parentDocs, isGuided, profileRules, mergedProjectRules
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

function buildSystemPrompt(profile, project, parentProject, memories, recentSessions, libraryDocs, skillDocs, templateDocs, orgDocs, projectDocs, parentDocs, isGuided, profileRules, projectRules) {

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

  // Inject writing rules immediately after core identity
  p += buildRulesBlock(profileRules, projectRules);

  // User profile
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

  // Organisation docs
  if (orgDocs && orgDocs.length > 0) {
    p += '\n\n## Organisation Guidelines';
    orgDocs.forEach(d => {
      p += '\n\n### ' + d.title;
      p += '\n' + d.content.slice(0, 4000);
    });
  }

  // Parent project context
  if (parentProject) {
    p += '\n\n## Parent Project: ' + parentProject.name;
    if (parentProject.description) p += '\n' + parentProject.description;
    if (parentProject.objectives) p += '\nObjectives: ' + parentProject.objectives;
    if (parentProject.custom_instructions) p += '\nInstructions: ' + parentProject.custom_instructions;
  }

  // Active project or sub-project
  if (project) {
    const label = parentProject ? '## Active Sub-project: ' + project.name : '## Active Project: ' + project.name;
    p += '\n\n' + label;
    if (project.description) p += '\n' + project.description;
    if (project.objectives) p += '\nObjectives: ' + project.objectives;
    if (project.custom_instructions) p += '\nProject instructions: ' + project.custom_instructions;
    if (project.artefact_preference) p += '\nProject output format: ' + project.artefact_preference;
    if (project.high_scrutiny) p += '\n\nHIGH SCRUTINY MODE (project): Flag all assumptions. Recommend verification.';
  }

  // Session memories and pinned notes
  if (memories && memories.length > 0) {
    p += '\n\n## Relevant Memories and Pinned Notes';
    memories.forEach(m => { p += '\n- ' + m.content; });
  }

  // Recent session summaries
  if (recentSessions && recentSessions.length > 0) {
    p += '\n\n## Recent Session Summaries';
    recentSessions.forEach(s => {
      p += '\n\n### ' + (s.title || 'Session') + ' (' + new Date(s.created_at).toLocaleDateString('en-AU') + ')';
      p += '\n' + s.summary;
    });
  }

  // Skills
  if (skillDocs && skillDocs.length > 0) {
    p += '\n\n## Skills and Approaches';
    skillDocs.forEach(d => {
      p += '\n\n### ' + d.title;
      p += '\n' + d.content.slice(0, 2000);
    });
  }

  // Templates
  if (templateDocs && templateDocs.length > 0) {
    p += '\n\n## Available Templates';
    p += '\nThe following templates are available. When the user asks to complete a template, ' +
      'use the relevant one and fill every field using the project context and conversation.';
    templateDocs.forEach(d => {
      p += '\n\n### Template: ' + d.title;
      p += '\n' + d.content.slice(0, 4000);
    });
  }

  // Library docs
  if (libraryDocs && libraryDocs.length > 0) {
    p += '\n\n## Relevant Frameworks and Guidance';
    libraryDocs.forEach(d => {
      p += '\n\n### ' + d.title;
      p += '\n' + d.content.slice(0, 8000);
      if (d.source_url) p += '\nSource: ' + d.source_url;
    });
  }

  // Sub-project documents
  if (projectDocs && projectDocs.length > 0) {
    p += '\n\n## ' + (parentProject ? 'Sub-project Documents' : 'Project Documents');
    projectDocs.forEach(d => {
      p += '\n\n### ' + d.filename;
      p += '\n' + d.content.slice(0, 8000);
    });
  }

  // Parent project documents
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