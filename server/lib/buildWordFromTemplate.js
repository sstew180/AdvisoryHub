// =============================================================================
// server/lib/buildWordFromTemplate.js
//
// Renders prepared templates that have been pre-marked with docxtemplater
// placeholders. The templates ship with the codebase at server/templates/
// and use docxtemplater syntax: {field} for inline values, {#loop}{/loop}
// for repeated paragraph blocks.
//
// Supported templates (PROF-1 Phase B / C):
//   - briefing_note      City of Gold Coast briefing note format
//   - analysis_summary   Self-driven analysis (light metadata, flexible sections)
//   - governance_paper   Council/committee paper (decision type, flexible sections)
//   - status_report      Periodic update (period covered, flexible sections)
//   - meeting_notes      Minutes (attendees, apologies, agenda items w/ actions)
//   - options_analysis   Option comparison (flexible sections + options sub-loop)
//   - formal_email       Salutation + body + sign-off + signature
//
// To add a new template:
//   1. Prepare the .docx with placeholders.
//   2. Drop the prepared file in server/templates/.
//   3. Add an entry to TEMPLATES below.
//   4. Add a builder function and export it.
//   5. Update buildWord.js to dispatch the new template name.
//   6. Update the tool schema in copilot.js (and chat.js) to allow it.
// =============================================================================

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

// Map of template name to filename. Files are read at render time, not at
// module load time, because Render's filesystem is fine but local dev sometimes
// reloads modules before all files are written.
const TEMPLATES = {
  briefing_note:    'briefing-note-gold-coast.docx',
  analysis_summary: 'analysis-summary-gold-coast.docx',
  governance_paper: 'governance-paper-gold-coast.docx',
  status_report:    'status-report-gold-coast.docx',
  meeting_notes:    'meeting-notes-gold-coast.docx',
  options_analysis: 'options-analysis-gold-coast.docx',
  formal_email:     'formal-email-gold-coast.docx',
};

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

/**
 * Render a prepared template with the given data.
 *
 * @param {string} templateName  Key from TEMPLATES (e.g. 'briefing_note').
 * @param {object} data          Field values matching the template's placeholders.
 * @returns {Promise<Buffer>}    .docx bytes ready to upload.
 */
async function renderTemplate(templateName, data) {
  const filename = TEMPLATES[templateName];
  if (!filename) {
    throw new Error(`Unknown template: ${templateName}`);
  }

  const templatePath = path.join(TEMPLATE_DIR, filename);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file missing: ${templatePath}`);
  }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true, // required so {#sections} consumes its own paragraph
    linebreaks: true,
  });

  doc.render(data);

  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// =============================================================================
// Builders
// =============================================================================

/**
 * Build a Gold Coast briefing note from structured input.
 *
 * Maps the create_word_document tool input shape (title, metadata, sections)
 * onto the template's expected data shape. Defensive defaults so missing
 * fields render as blank rather than crashing.
 */
async function buildBriefingNote(input) {
  const title = (input && input.title) || 'Briefing note';
  const metadata = (input && input.metadata) || {};

  const sections = collectSections(input);

  const data = {
    to:        coerceText(metadata.to),
    copy:      coerceText(metadata.copy),
    from:      coerceText(metadata.from),
    action_by: coerceText(metadata.action_by),
    subject:   coerceText(metadata.subject) || title,
    date:      coerceText(metadata.date) || todayAU(),
    file_no:   coerceText(metadata.file_no),
    sections,
  };

  return renderTemplate('briefing_note', data);
}

/**
 * Analysis summary. Light metadata, flexible sections.
 */
async function buildAnalysisSummary(input) {
  const title = (input && input.title) || 'Analysis summary';
  const metadata = (input && input.metadata) || {};

  const data = {
    subject:   coerceText(metadata.subject) || title,
    author:    coerceText(metadata.author),
    date:      coerceText(metadata.date) || todayAU(),
    reference: coerceText(metadata.reference),
    sections:  collectSections(input),
  };

  return renderTemplate('analysis_summary', data);
}

/**
 * Governance paper. Medium metadata (To, Meeting date, Decision type), flexible sections.
 */
async function buildGovernancePaper(input) {
  const title = (input && input.title) || 'Governance paper';
  const metadata = (input && input.metadata) || {};

  const data = {
    title:         coerceText(metadata.title) || title,
    to:            coerceText(metadata.to),
    meeting_date:  coerceText(metadata.meeting_date) || todayAU(),
    author:        coerceText(metadata.author),
    decision_type: coerceText(metadata.decision_type),
    reference:     coerceText(metadata.reference),
    sections:      collectSections(input),
  };

  return renderTemplate('governance_paper', data);
}

/**
 * Status report. Period-based metadata, flexible sections.
 */
async function buildStatusReport(input) {
  const title = (input && input.title) || 'Status report';
  const metadata = (input && input.metadata) || {};

  const data = {
    title:          coerceText(metadata.title) || title,
    period_covered: coerceText(metadata.period_covered),
    author:         coerceText(metadata.author),
    date_prepared:  coerceText(metadata.date_prepared) || todayAU(),
    reference:      coerceText(metadata.reference),
    sections:       collectSections(input),
  };

  return renderTemplate('status_report', data);
}

/**
 * Meeting notes. Full metadata plus nested sub-loops for attendees, apologies,
 * and agenda items (each with discussion, decisions, and actions).
 */
async function buildMeetingNotes(input) {
  const title = (input && input.title) || 'Meeting notes';
  const metadata = (input && input.metadata) || {};

  const attendees = coerceStringArray(input.attendees);
  const apologies = coerceStringArray(input.apologies);

  const rawAgenda = Array.isArray(input.agenda_items) ? input.agenda_items : [];
  const agenda_items = rawAgenda.map(normaliseAgendaItem).filter(a => a !== null);
  if (agenda_items.length === 0) {
    agenda_items.push({
      topic: 'Agenda item',
      discussion: ['(No agenda items captured.)'],
      decisions: [],
      actions: [],
    });
  }

  const data = {
    title:        coerceText(metadata.title) || title,
    date:         coerceText(metadata.date) || todayAU(),
    time:         coerceText(metadata.time),
    location:     coerceText(metadata.location),
    chair:        coerceText(metadata.chair),
    minute_taker: coerceText(metadata.minute_taker),
    reference:    coerceText(metadata.reference),
    attendees,
    apologies,
    agenda_items,
  };

  return renderTemplate('meeting_notes', data);
}

/**
 * Options analysis. Flexible sections plus a dedicated options sub-loop
 * (each option has name, description, strengths, weaknesses).
 */
async function buildOptionsAnalysis(input) {
  const title = (input && input.title) || 'Options analysis';
  const metadata = (input && input.metadata) || {};

  const rawOptions = Array.isArray(input.options) ? input.options : [];
  const options = rawOptions.map(normaliseOption).filter(o => o !== null);
  if (options.length === 0) {
    options.push({
      name: 'Option 1',
      description: '(No options were generated.)',
      strengths: [],
      weaknesses: [],
    });
  }

  const data = {
    title:           coerceText(metadata.title) || title,
    author:          coerceText(metadata.author),
    date:            coerceText(metadata.date) || todayAU(),
    reference:       coerceText(metadata.reference),
    decision_sought: coerceText(metadata.decision_sought),
    sections:        collectSections(input),
    options,
  };

  return renderTemplate('options_analysis', data);
}

/**
 * Formal email. Salutation, body paragraphs, sign-off, signature lines.
 * Reference block fields (to, subject, from) come from metadata.
 */
async function buildFormalEmail(input) {
  const title = (input && input.title) || 'Formal email';
  const metadata = (input && input.metadata) || {};

  let bodyParagraphs = coerceStringArray(input.body_paragraphs);
  if (bodyParagraphs.length === 0) {
    bodyParagraphs = ['(No body content was generated.)'];
  }

  const data = {
    to:              coerceText(metadata.to),
    subject:         coerceText(metadata.subject) || title,
    from:            coerceText(metadata.from),
    salutation:      coerceText(input.salutation) || 'Hello,',
    body_paragraphs: bodyParagraphs,
    signoff:         coerceText(input.signoff) || 'Kind regards,',
    signature:       coerceStringArray(input.signature),
  };

  return renderTemplate('formal_email', data);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function todayAU() {
  return new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function coerceText(v) {
  if (typeof v !== 'string') return '';
  return v.trim();
}

function coerceStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'string' && x.trim().length > 0).map(x => x.trim());
}

function normaliseSection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const heading = typeof raw.heading === 'string' ? raw.heading.trim() : '';
  const paragraphs = coerceStringArray(raw.paragraphs);
  const bullets = coerceStringArray(raw.bullets);

  if (!heading && paragraphs.length === 0 && bullets.length === 0) return null;

  return { heading, paragraphs, bullets };
}

// Collect and normalise the sections array, with a defensive fallback so the
// template always has at least one section to render. Shared by all the
// section-shaped templates.
function collectSections(input) {
  const rawSections = Array.isArray(input.sections) ? input.sections : [];
  const sections = rawSections.map(normaliseSection).filter(s => s !== null);
  if (sections.length === 0) {
    sections.push({
      heading: 'Content',
      paragraphs: ['(No content was generated.)'],
      bullets: [],
    });
  }
  return sections.map(s => ({
    heading: s.heading,
    paragraphs: s.paragraphs,
    bullets: s.bullets,
  }));
}

function normaliseAgendaItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const topic = typeof raw.topic === 'string' ? raw.topic.trim() : '';
  const discussion = coerceStringArray(raw.discussion);
  const decisions = coerceStringArray(raw.decisions);
  const actions = Array.isArray(raw.actions)
    ? raw.actions
        .filter(a => a && typeof a === 'object')
        .map(a => ({
          action:   coerceText(a.action),
          owner:    coerceText(a.owner),
          due_date: coerceText(a.due_date),
        }))
        .filter(a => a.action.length > 0)
    : [];

  if (!topic && discussion.length === 0 && decisions.length === 0 && actions.length === 0) {
    return null;
  }

  return { topic, discussion, decisions, actions };
}

function normaliseOption(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const strengths = coerceStringArray(raw.strengths);
  const weaknesses = coerceStringArray(raw.weaknesses);

  if (!name && !description && strengths.length === 0 && weaknesses.length === 0) {
    return null;
  }

  return { name, description, strengths, weaknesses };
}

module.exports = {
  renderTemplate,
  buildBriefingNote,
  buildAnalysisSummary,
  buildGovernancePaper,
  buildStatusReport,
  buildMeetingNotes,
  buildOptionsAnalysis,
  buildFormalEmail,
  TEMPLATES,
};