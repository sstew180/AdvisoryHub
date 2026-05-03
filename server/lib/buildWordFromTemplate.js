// =============================================================================
// server/lib/buildWordFromTemplate.js
//
// Renders prepared templates that have been pre-marked with docxtemplater
// placeholders. The templates ship with the codebase at server/templates/
// and use docxtemplater syntax: {field} for inline values, {#loop}{/loop}
// for repeated paragraph blocks.
//
// Currently supports:
//   - briefing_note: City of Gold Coast briefing note format
//
// To add a new template:
//   1. Prepare the .docx with placeholders (see prepare_template.js in repo
//      docs for the procedure used to prep briefing-note-gold-coast.docx).
//   2. Drop the prepared file in server/templates/.
//   3. Add an entry to TEMPLATES below.
//   4. Update buildWord.js to recognise the new template name.
//   5. Update the tool schema in chat.js to allow the new template name.
// =============================================================================

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

// Map of template name to filename. Files are read at render time, not at
// module load time, because Render's filesystem is fine but local dev sometimes
// reloads modules before all files are written.
const TEMPLATES = {
  briefing_note: 'briefing-note-gold-coast.docx',
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

  // Defensive coercion of sections. Same shape rules as buildWord.js.
  const rawSections = Array.isArray(input.sections) ? input.sections : [];
  const sections = rawSections
    .map(normaliseSection)
    .filter(s => s !== null);

  if (sections.length === 0) {
    sections.push({
      heading: 'Content',
      paragraphs: ['(No content was generated.)'],
      bullets: [],
    });
  }

  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const data = {
    to:        coerceText(metadata.to),
    copy:      coerceText(metadata.copy),
    from:      coerceText(metadata.from),
    action_by: coerceText(metadata.action_by),
    subject:   coerceText(metadata.subject) || title,
    date:      coerceText(metadata.date) || today,
    file_no:   coerceText(metadata.file_no),
    sections:  sections.map(s => ({
      heading: s.heading,
      paragraphs: s.paragraphs,
      bullets: s.bullets,
    })),
  };

  return renderTemplate('briefing_note', data);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function coerceText(v) {
  if (typeof v !== 'string') return '';
  return v.trim();
}

function normaliseSection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const heading = typeof raw.heading === 'string' ? raw.heading.trim() : '';
  const paragraphs = Array.isArray(raw.paragraphs)
    ? raw.paragraphs
        .filter(p => typeof p === 'string' && p.trim().length > 0)
        .map(p => p.trim())
    : [];
  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets
        .filter(b => typeof b === 'string' && b.trim().length > 0)
        .map(b => b.trim())
    : [];

  if (!heading && paragraphs.length === 0 && bullets.length === 0) return null;

  return { heading, paragraphs, bullets };
}

module.exports = { renderTemplate, buildBriefingNote, TEMPLATES };
