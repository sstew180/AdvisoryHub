# governance_paper template specification

**Status:** Template designed and smoke tested. Ready for Phase C wiring.

**File:** `server/templates/governance-paper-gold-coast.docx`

**Reference templates:** `briefing-note-gold-coast.docx` and `analysis-summary-gold-coast.docx`. Same docxtemplater pattern, same renderer in `server/lib/buildWordFromTemplate.js`.

---

## Design choices locked in this session

| Dimension | Choice |
| --- | --- |
| Branding | Gold Coast branded |
| Metadata | Medium: Title + To + Meeting date + Author + Decision type + Reference |
| Section structure | Flexible loop |
| Page size | A4 |
| Body font | Arial 11 pt |
| Title font | Arial 22 pt bold (prominent) |
| Heading colour | #0F6E78 (AdvisoryHub teal) |

The Title is rendered as a prominent block above the metadata table because the title of a council paper carries weight that a "Subject" row inside a metadata table does not.

---

## Placeholder schema

### Top-level metadata fields

| Placeholder | Type | Example |
| --- | --- | --- |
| `{title}` | string | "Adoption of updated procurement thresholds for FY2026" |
| `{to}` | string | "Audit and Risk Committee" |
| `{meeting_date}` | string | "15 June 2026" |
| `{author}` | string | "Scott Stewart, Manager Risk and Insurance" |
| `{decision_type}` | string | "For Endorsement" |
| `{reference}` | string | "GP-2026-008" |

Suggested values for `{decision_type}`: "For Noting", "For Endorsement", "For Decision". The template does not constrain the field; the `preferenceMap.js` instruction for `governance_paper` should give the model this guidance.

### Body loop

```
{#sections}
  {heading}
  {#paragraphs}{.}{/paragraphs}
  {#bullets}{.}{/bullets}
{/sections}
```

Identical structure to analysis_summary. Empty paragraphs or bullets arrays render nothing.

---

## Expected data shape for the builder

```javascript
{
  title:         'string',
  to:            'string',
  meeting_date:  'string',
  author:        'string',
  decision_type: 'string',
  reference:     'string',
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

Section shape reuses `normaliseSection` from `buildWordFromTemplate.js`.

---

## Phase C wiring (to be done in a future session)

When you get to PROF-1 Phase C, the changes for governance_paper are:

### 1. `server/lib/buildWordFromTemplate.js`

Add to the `TEMPLATES` map:

```javascript
const TEMPLATES = {
  briefing_note:     'briefing-note-gold-coast.docx',
  analysis_summary:  'analysis-summary-gold-coast.docx',
  governance_paper:  'governance-paper-gold-coast.docx',
};
```

Add a `buildGovernancePaper` function:

```javascript
async function buildGovernancePaper(input) {
  const title = (input && input.title) || 'Governance paper';
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
    title:         coerceText(metadata.title) || title,
    to:            coerceText(metadata.to),
    meeting_date:  coerceText(metadata.meeting_date) || today,
    author:        coerceText(metadata.author),
    decision_type: coerceText(metadata.decision_type),
    reference:     coerceText(metadata.reference),
    sections:      sections.map(s => ({
      heading: s.heading,
      paragraphs: s.paragraphs,
      bullets: s.bullets,
    })),
  };

  return renderTemplate('governance_paper', data);
}

module.exports = {
  renderTemplate,
  buildBriefingNote,
  buildAnalysisSummary,
  buildGovernancePaper,
  TEMPLATES,
};
```

### 2. `server/lib/buildWord.js`

Add the dispatch branch:

```javascript
if (templateName === 'governance_paper') return buildGovernancePaper(input);
```

### 3. `server/routes/copilot.js`

Expand the `template` enum:

```javascript
template: {
  type: 'string',
  enum: ['briefing_note', 'analysis_summary', 'governance_paper'],
  ...
}
```

Expand the metadata properties to cover `to`, `meeting_date`, `decision_type`. Update the prompt prose so Claude knows when to pick `governance_paper` (typically when the user is preparing for a council meeting, board, audit committee, or other formal governance body, and the document is being put forward for noting, endorsement, or decision).

### 4. No database changes

The `artefact_preference` column already accepts `governance_paper` as a valid key from PROF-1 Phase A.

---

## Smoke test result

Sample data exercised all six metadata fields and six section blocks with mixed paragraphs and bullets. Output validated. Renders to a clean two-page document with correct pagination.
