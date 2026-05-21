# analysis_summary template specification

**Status:** Template designed and smoke tested. Ready for Phase C wiring.

**File:** `server/templates/analysis-summary-gold-coast.docx`

**Reference template:** `briefing-note-gold-coast.docx` (same docxtemplater pattern, same renderer in `server/lib/buildWordFromTemplate.js`).

---

## Design choices locked in this session

| Dimension | Choice |
| --- | --- |
| Branding | Gold Coast branded |
| Metadata | Light: Subject, Author, Date, Reference |
| Section structure | Flexible loop (single `{#sections}` block) |
| Page size | A4 (210 x 297 mm) |
| Body font | Arial 11 pt |
| Heading colour | #0F6E78 (AdvisoryHub teal) |

If the existing `briefing-note-gold-coast.docx` uses a different heading colour or font, open the new template in Word once and adjust the heading style and rule colour to match. The placeholders are unaffected by formatting changes.

---

## Placeholder schema (literal text in the .docx)

### Top-level metadata fields

| Placeholder | Type | Example |
| --- | --- | --- |
| `{subject}` | string | "Procurement threshold review for FY2026" |
| `{author}` | string | "Scott Stewart, Manager Risk and Insurance" |
| `{date}` | string | "21 May 2026" |
| `{reference}` | string | "AS-2026-014" |

### Body loop

```
{#sections}
  {heading}
  {#paragraphs}{.}{/paragraphs}
  {#bullets}{.}{/bullets}
{/sections}
```

Each section iterates with three fields: a heading (rendered as Heading 2 in brand teal), an array of paragraphs (each becomes its own paragraph), and an array of bullets (each becomes its own bullet list item).

Empty `paragraphs` or `bullets` arrays render nothing. This is intentional. A section with only paragraphs (no bullets) suppresses the bullet block, and vice versa.

---

## Expected data shape for the builder

```javascript
{
  subject:   'string',
  author:    'string',
  date:      'string',
  reference: 'string',
  sections: [
    {
      heading: 'string',
      paragraphs: ['string', 'string', ...],
      bullets:    ['string', 'string', ...],
    },
    ...
  ]
}
```

The `sections` array reuses the same shape as `briefing_note`. The `normaliseSection` helper in `buildWordFromTemplate.js` can be reused as is.

---

## Phase C wiring (to be done in a future session)

When you get to PROF-1 Phase C, the changes needed are:

### 1. `server/lib/buildWordFromTemplate.js`

Add to the `TEMPLATES` map:

```javascript
const TEMPLATES = {
  briefing_note:    'briefing-note-gold-coast.docx',
  analysis_summary: 'analysis-summary-gold-coast.docx',
};
```

Add a `buildAnalysisSummary` function. The shape is almost identical to `buildBriefingNote`. Differences: no `to`, no `copy`, no `action_by`, no `file_no`. Replace those with `author` and `reference`.

```javascript
async function buildAnalysisSummary(input) {
  const title = (input && input.title) || 'Analysis summary';
  const metadata = (input && input.metadata) || {};

  const rawSections = Array.isArray(input.sections) ? input.sections : [];
  const sections = rawSections.map(normaliseSection).filter(s => s !== null);

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
    subject:   coerceText(metadata.subject) || title,
    author:    coerceText(metadata.author),
    date:      coerceText(metadata.date) || today,
    reference: coerceText(metadata.reference),
    sections:  sections.map(s => ({
      heading: s.heading,
      paragraphs: s.paragraphs,
      bullets: s.bullets,
    })),
  };

  return renderTemplate('analysis_summary', data);
}

module.exports = {
  renderTemplate,
  buildBriefingNote,
  buildAnalysisSummary,
  TEMPLATES,
};
```

### 2. `server/lib/buildWord.js`

Import the new builder and add the dispatch branch:

```javascript
const {
  buildBriefingNote,
  buildAnalysisSummary,
  TEMPLATES,
} = require('./buildWordFromTemplate');

// inside buildWordDocument:
if (templateName === 'briefing_note')    return buildBriefingNote(input);
if (templateName === 'analysis_summary') return buildAnalysisSummary(input);
```

### 3. `server/routes/copilot.js` (or `chat.js` in AHP)

Expand the `template` enum in the `create_word_document` tool schema:

```javascript
template: {
  type: 'string',
  enum: ['briefing_note', 'analysis_summary'],
  description: '... (extend description to mention analysis_summary)',
}
```

Expand the metadata properties to cover `author` and `reference`. Update the prompt prose so Claude knows when to pick `analysis_summary` (typically when the user asks for an analysis, review, position summary, or similar self-driven analytical artefact, as opposed to a briefing note directed at a recipient).

### 4. No database changes

The `artefact_preference` column already accepts `analysis_summary` as a valid key from PROF-1 Phase A. No migration needed.

---

## Smoke test

Reproducible smoke test that exercises the production code path is in `/home/claude/work/smoke-test-template.js`. Equivalent test data:

```javascript
{
  subject: 'Procurement threshold review for FY2026',
  author: 'Scott Stewart, Manager Risk and Insurance',
  date: '21 May 2026',
  reference: 'AS-2026-014',
  sections: [
    { heading: 'Purpose', paragraphs: ['...', '...'], bullets: [] },
    { heading: 'Findings', paragraphs: ['...'], bullets: ['...', '...', '...'] },
    { heading: 'Recommendation', paragraphs: ['...'], bullets: [] },
    { heading: 'Next Steps', paragraphs: [], bullets: ['...', '...', '...'] },
  ],
}
```

Smoke test result: PASS. Output validated. Renders cleanly to single A4 page for the sample content above.
