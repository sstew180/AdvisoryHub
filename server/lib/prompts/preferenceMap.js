// =============================================================================
// preferenceMap.js
// =============================================================================
// Card #258 (Phase 1 Sprint 2)
//
// Translates structured preference column values from the profiles table
// into system prompt instructions. Project-level overrides are merged on
// top of profile preferences via effectivePreferences().
//
// Each instruction is a single concrete directive, written in the spirit
// of the "How to Train Your AI" framework: ban common patterns, require
// evidence, force consequence, narrow the corridor.
//
// Adding a new preference value:
//   1. Add the key/value entry to INSTRUCTIONS below.
//   2. If it is a boolean, handle it in buildWorkingStyleBlock or
//      buildQualityBlock as appropriate.
//   3. No changes to chat.js are needed for new preference values,
//      only for new preference dimensions.
// =============================================================================

// -----------------------------------------------------------------------------
// INSTRUCTIONS dictionary
// Keyed by preference column name, then by value.
// Each entry is a single instruction sentence (or short paragraph).
// -----------------------------------------------------------------------------

const INSTRUCTIONS = {

  default_stance: {
    challenge:
      "Default to challenge mode. Identify weaknesses, unrealistic assumptions, " +
      "and unsupported claims in what the user has provided. Do not affirm " +
      "assertions without counter-analysis. If the user states a position, test " +
      "it against evidence and surface what is missing.",
    neutral:
      "Maintain analytical neutrality. Present the case for and against with " +
      "comparable weight. Do not advocate or affirm without supporting evidence.",
    support:
      "Provide supportive framing alongside analysis. Acknowledge what is working " +
      "before raising concerns. Frame challenges as opportunities to strengthen " +
      "the work, not as criticism."
  },

  output_density: {
    scannable:
      "Use scannable structure: short paragraphs, headers where they help, bullets " +
      "where the content is genuinely list-shaped. The reader should be able to " +
      "extract the key points in under thirty seconds.",
    mixed:
      "Mix prose paragraphs with structured elements. Default to prose for reasoning " +
      "and analysis. Use lists only when the content is genuinely list-shaped " +
      "(steps, items, options).",
    dense:
      "Use dense analytical paragraphs. Avoid bullet lists and headers unless the " +
      "artefact format requires them. Pack reasoning, evidence, and conclusions " +
      "into continuous prose."
  },

  tone_register: {
    formal_direct:
      "Write formally and directly. Short declarative sentences. No softening, no " +
      "hedging, no preamble. State conclusions before reasoning where the conclusion " +
      "is clear.",
    formal_precise:
      "Write formally and with precision. Use exact terminology. Define terms where " +
      "ambiguity is possible. Cite sources for material claims.",
    plain_professional:
      "Write in plain professional English. Avoid corporate jargon (leverage, optimise, " +
      "unlock, transformative, holistic, ecosystem, synergy) and abstract nouns. " +
      "Prefer concrete language over conceptual.",
    conversational:
      "Write conversationally with a natural rhythm. Address the reader directly " +
      "where appropriate. Maintain professionalism without formality."
  },

  uncertainty_handling: {
    hedge_briefly:
      "Where uncertainty exists, acknowledge it briefly without disclaimers. Do not " +
      "over-hedge. Move on to the substance quickly.",
    acknowledge:
      "Acknowledge uncertainty openly when it materially affects the conclusion. " +
      "Name what you do not know. Do not pad with excessive qualifiers.",
    ranges:
      "Express uncertainty as ranges or scenarios where the matter is quantitative. " +
      "Provide best-case, base-case, and downside where relevant.",
    flag_every:
      "Flag every assumption, gap in evidence, and area of uncertainty explicitly. " +
      "The reader must be able to distinguish what is grounded from what is inference."
  },

  failure_mode_default: {
    on_request:
      "Model failure modes only when the user explicitly requests them.",
    always:
      "For every recommendation or initiative discussed, include how it could fail, " +
      "the impact of failure, and the earliest warning signal. Failure modelling is " +
      "mandatory, not optional.",
    never:
      "Do not model failure modes unless the user explicitly asks. Focus on the " +
      "intended outcome and execution path."
  },

  affirmation_level: {
    zero:
      "Use no conversational praise or validation. Do not write phrases such as " +
      "'great question', 'you're right', 'that's an excellent point', or 'you're " +
      "circling something important'. Maintain analytical neutrality.",
    warranted:
      "Praise or affirmation is permitted only when directly tied to specific evidence " +
      "(for example, 'this approach is well supported because the Q3 data shows...'). " +
      "Bare affirmation without evidence is banned.",
    allowed_when_warranted:
      "Praise or affirmation is permitted when tied to evidence and used sparingly. " +
      "Avoid reflexive validation language.",
    conversational:
      "Conversational warmth is permitted. Affirmation is acceptable as part of " +
      "natural dialogue, but should not substitute for analysis."
  },

  length_default: {
    short:
      "Default to short responses. Aim for the minimum length needed to address the " +
      "request fully. Cut anything not essential. Long responses must be justified " +
      "by the request.",
    medium:
      "Default to medium-length responses. Provide enough context to be useful " +
      "without expanding beyond what was asked.",
    long:
      "Default to long, comprehensive responses. Cover the topic in depth with " +
      "supporting reasoning, alternatives considered, and citations."
  },

  citation_density: {
    light:
      "Cite sources only for major claims or where the user explicitly requests " +
      "citations.",
    moderate:
      "Cite sources for material claims drawn from retrieved documents. Use inline " +
      "references that name the document.",
    heavy:
      "Cite sources for every material claim. Include source titles inline. Where " +
      "claims are not from a retrieved source, label them explicitly as inference " +
      "or general knowledge."
  },

  clarification_style: {
    ask_if_material:
      "Ask clarifying questions only when the answer would materially change the " +
      "response. Do not ask for cosmetic preferences.",
    ask_before_drafting:
      "Ask clarifying questions before drafting if the request leaves material " +
      "ambiguity. List the questions clearly and concisely.",
    assume_and_flag:
      "Make reasonable assumptions and proceed. State each assumption explicitly at " +
      "the top of your response so the user can correct any that are wrong."
  },

  default_artefact: {
    briefing_note:
      "When the artefact type is not specified, default to a briefing note format: " +
      "short executive summary, key points, recommendation, next steps.",
    email:
      "When the artefact type is not specified, default to an email format: " +
      "appropriate opening, body in short paragraphs, clear next step.",
    memo:
      "When the artefact type is not specified, default to a memo format: dense " +
      "paragraphs, financial ranges where relevant, approving authority noted where " +
      "appropriate.",
    report:
      "When the artefact type is not specified, default to a report format: sections " +
      "with headings, supporting evidence, conclusions and recommendations.",
    bullet_summary:
      "When the artefact type is not specified, default to a bullet summary: concise " +
      "points, no narrative padding.",
    board_paper:
      "When the artefact type is not specified, default to a board paper format: " +
      "purpose, background, options analysis with risks, recommendation, decision " +
      "sought."
  },

  pushback_explicitness: {
    explicit:
      "When you disagree with a stated position or assumption, say so explicitly and " +
      "state your reason. Do not silently rewrite the user's framing to your preferred " +
      "answer.",
    silent:
      "When you disagree with a stated position, rework the output toward what you " +
      "believe is correct without overt disagreement. The user will see the result " +
      "in the output."
  },

  auto_pin: {
    aggressive:
      "Treat substantive decisions, named entities, and concrete numbers as " +
      "candidates for memory pinning. Note these prominently so they are easy to " +
      "retrieve in later sessions.",
    conservative:
      "Treat only explicit user decisions and confirmed facts as memory candidates. " +
      "Do not over-pin.",
    manual_only:
      "Do not surface pinning suggestions. The user will pin items manually."
  },

  session_freshness: {
    pull_prior:
      "Where relevant prior session context exists, integrate it into your response " +
      "and reference what was previously discussed.",
    fresh_per_session:
      "Treat each session as fresh. Do not draw on prior sessions unless the user " +
      "explicitly references them."
  }

};

// -----------------------------------------------------------------------------
// effectivePreferences
// Merges project-level preference_overrides on top of profile defaults.
// Project values win where set. Returns a flat object suitable for passing
// to the build* functions below.
// -----------------------------------------------------------------------------

function effectivePreferences(profile, project) {
  const base = profile || {};
  const overrides = (project && project.preference_overrides) || {};
  return { ...base, ...overrides };
}

// -----------------------------------------------------------------------------
// buildIdentityBlock
// Always applied, even in Direct mode. Provides the user context needed
// for accurate, audience-appropriate responses.
// -----------------------------------------------------------------------------

function buildIdentityBlock(prefs) {
  if (!prefs) return '';
  const lines = [];

  if (prefs.role) lines.push(`Role: ${prefs.role}`);
  if (prefs.service_area) lines.push(`Service Area: ${prefs.service_area}`);
  if (prefs.organisation) lines.push(`Organisation: ${prefs.organisation}`);
  if (prefs.jurisdiction) lines.push(`Jurisdiction: ${prefs.jurisdiction}`);

  if (Array.isArray(prefs.industry) && prefs.industry.length > 0) {
    lines.push(`Industry: ${prefs.industry.join(', ')}`);
  }
  if (prefs.seniority) lines.push(`Seniority: ${prefs.seniority}`);
  if (prefs.years_in_domain != null) {
    lines.push(`Years in domain: ${prefs.years_in_domain}`);
  }
  if (prefs.goals) lines.push(`Current Objectives: ${prefs.goals}`);

  if (lines.length === 0) return '';
  return `\n\n## User Identity and Context\n${lines.join('\n')}`;
}

// -----------------------------------------------------------------------------
// buildHardConstraintsBlock
// Always applied. These are user-set rules that must not be bypassed
// regardless of mode (banned words, redactions, language).
// -----------------------------------------------------------------------------

function buildHardConstraintsBlock(prefs) {
  if (!prefs) return '';
  const lines = [];

  if (prefs.australian_english) {
    lines.push(
      "Use Australian English spelling and idiom (organisation, programme, " +
      "behaviour, analyse, centre)."
    );
  }

  if (prefs.banned_words && prefs.banned_words.trim()) {
    lines.push(
      `Do not use the following words or phrases under any circumstances: ` +
      `${prefs.banned_words.trim()}.`
    );
  }

  if (prefs.confidentiality_redactions && prefs.confidentiality_redactions.trim()) {
    lines.push(
      `Do not reference the following items: ${prefs.confidentiality_redactions.trim()}. ` +
      `If the user asks about these items, decline politely and explain that they ` +
      `are subject to confidentiality redaction.`
    );
  }

  if (lines.length === 0) return '';
  return `\n\n## Hard Constraints\n${lines.map(l => `- ${l}`).join('\n')}`;
}

// -----------------------------------------------------------------------------
// buildWorkingStyleBlock
// Guided mode only. The full structured preference instruction set,
// rendered as a list of one-instruction-per-line directives.
// -----------------------------------------------------------------------------

function buildWorkingStyleBlock(prefs) {
  if (!prefs) return '';
  const lines = [];

  for (const key of Object.keys(INSTRUCTIONS)) {
    const value = prefs[key];
    if (value && INSTRUCTIONS[key][value]) {
      lines.push(INSTRUCTIONS[key][value]);
    }
  }

  // Methodologies: jsonb array or comma-separated string
  if (prefs.preferred_methodologies) {
    const methods = Array.isArray(prefs.preferred_methodologies)
      ? prefs.preferred_methodologies
      : (typeof prefs.preferred_methodologies === 'string'
          ? prefs.preferred_methodologies.split(',').map(s => s.trim())
          : []);
    if (methods.length > 0) {
      lines.push(
        `Where methodology is relevant, prefer the following frameworks: ` +
        `${methods.join(', ')}.`
      );
    }
  }

  if (lines.length === 0) return '';
  return `\n\n## Working Style\n${lines.map(l => `- ${l}`).join('\n')}`;
}

// -----------------------------------------------------------------------------
// buildVoiceMarkersBlock
// Guided mode only. Voice markers extracted from voice samples and
// anti-pattern markers extracted from anti-pattern samples (Phase 2).
// For Phase 1 these will typically be null. The block renders only if
// markers are present.
// -----------------------------------------------------------------------------

function buildVoiceMarkersBlock(prefs) {
  if (!prefs) return '';
  const sections = [];

  if (prefs.voice_markers && Object.keys(prefs.voice_markers).length > 0) {
    const markerLines = Object.entries(prefs.voice_markers).map(
      ([key, value]) => `- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`
    );
    sections.push(`### Voice Markers (match these patterns)\n${markerLines.join('\n')}`);
  }

  if (prefs.anti_pattern_markers && Object.keys(prefs.anti_pattern_markers).length > 0) {
    const antiLines = Object.entries(prefs.anti_pattern_markers).map(
      ([key, value]) => `- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`
    );
    sections.push(`### Anti-Pattern Markers (avoid these patterns)\n${antiLines.join('\n')}`);
  }

  if (sections.length === 0) return '';
  return `\n\n## Voice and Language\n${sections.join('\n\n')}`;
}

// -----------------------------------------------------------------------------
// buildQualityBlock
// Always applied. High scrutiny and self-audit are quality flags, not
// style preferences, so they apply in both Guided and Direct modes.
// -----------------------------------------------------------------------------

function buildQualityBlock(prefs) {
  if (!prefs) return '';
  const lines = [];

  if (prefs.high_scrutiny) {
    lines.push(
      "HIGH SCRUTINY MODE: flag all assumptions explicitly. Note limitations of " +
      "the analysis. Recommend independent verification before the output is used " +
      "for any binding decision."
    );
  }

  if (prefs.self_audit_enabled) {
    lines.push(
      "After drafting, audit your own output before delivering it. Check for: " +
      "abstract concepts not tied to data; balanced contrast structures " +
      "('not just X but Y'); slogan-like closing sentences; unsupported major " +
      "claims; and banned words. If any are found, rewrite before responding."
    );
  }

  if (lines.length === 0) return '';
  return `\n\n## Quality Requirements\n${lines.map(l => `- ${l}`).join('\n')}`;
}

// -----------------------------------------------------------------------------
// buildLegacyPreferencesBlock
// Backward compatibility. The free-form profile.preferences text field
// is preserved for one phase per the Sprint 1 risk mitigation. If the
// user has populated it, render it as supplementary user notes.
// -----------------------------------------------------------------------------

function buildLegacyPreferencesBlock(prefs) {
  if (!prefs || !prefs.preferences || !prefs.preferences.trim()) return '';
  return (
    `\n\n## Additional User Notes\n` +
    `${prefs.preferences.trim()}`
  );
}

// -----------------------------------------------------------------------------
// describeConfigurationSource
// Returns a short human-readable description of where the active
// configuration came from. Used by chat.js for the status message.
// -----------------------------------------------------------------------------

function describeConfigurationSource(profile) {
  if (!profile) return null;
  if (profile.applied_preset) {
    const pretty = String(profile.applied_preset).replace(/\b\w/g, c => c.toUpperCase());
    return `${pretty} preset`;
  }
  if (profile.disc_completed) {
    return 'DISC-derived working style';
  }
  if (profile.preferences && profile.preferences.trim()) {
    return 'custom communication style';
  }
  return null;
}

module.exports = {
  INSTRUCTIONS,
  effectivePreferences,
  buildIdentityBlock,
  buildHardConstraintsBlock,
  buildWorkingStyleBlock,
  buildVoiceMarkersBlock,
  buildQualityBlock,
  buildLegacyPreferencesBlock,
  describeConfigurationSource
};
