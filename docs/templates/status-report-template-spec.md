# status_report template specification

**Status:** Template designed and smoke tested. Ready for Phase C wiring.

**File:** `server/templates/status-report-gold-coast.docx`

**Reference templates:** `briefing-note-gold-coast.docx`, `analysis-summary-gold-coast.docx`, `governance-paper-gold-coast.docx`.

---

## Design choices locked in this session

| Dimension | Choice |
| --- | --- |
| Branding | Gold Coast branded |
| Metadata | Medium: Title + Period covered + Author + Date prepared + Reference |
| Section structure | Flexible loop |
| Page size | A4 |
| Body font | Arial 11 pt |
| Title font | Arial 22 pt bold (prominent) |
| Heading colour | #0F6E78 (AdvisoryHub teal) |

---

## Placeholder schema

### Top-level metadata fields

| Placeholder | Type | Example |
| --- | --- | --- |
| `{title}` | string | "Risk and Insurance Function: May 2026 Update" |
| `{period_covered}` | string | "1 May 2026 - 31 May 2026" |
| `{author}` | string | "Scott Stewart, Manager Risk and Insurance" |
| `{date_prepared}` | string | "31 May 2026" |
| `{reference}` | string | "SR-RI-2026-05" |

### Body loop

```
{#sections}
  {heading}
  {#paragraphs}{.}{/paragraphs}
  {#bullets}{.}{/bullets}
{/sections}
```

Identical structure to analysis_summary and governance_paper. Typical sections suggested by the `status_report` instruction in `preferenceMap.js` should be: Achievements this period, In progress, Blockers and risks, Next period.

---

## Expected data shape for the builder

```javascript
{
  title:          'string',
  period_covered: 'string',
  author:         'string',
  date_prepared:  'string',
  reference:      'string',
  sections: [
    {
      heading: 'string',
      paragraphs: ['string', ...],
      bullets:    ['string', ...],
    },
    ...
  ]
}
```

---

## Phase C wiring (to be done in a future session)

### 1. `server/lib/buildWordFromTemplate.js`

Add to `TEMPLATES`:

```javascript
status_report: 'status-report-gold-coast.docx',
```

Add a `buildStatusReport` function:

```javascript
async function buildStatusReport(input) {
  const title = (input && input.title) || 'Status report';
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
    title:          coerceText(metadata.title) || title,
    period_covered: coerceText(metadata.period_covered),
    author:         coerceText(metadata.author),
    date_prepared:  coerceText(metadata.date_prepared) || today,
    reference:      coerceText(metadata.reference),
    sections:       sections.map(s => ({
      heading: s.heading,
      paragraphs: s.paragraphs,
      bullets: s.bullets,
    })),
  };

  return renderTemplate('status_report', data);
}
```

Export it alongside the other builders.

### 2. `server/lib/buildWord.js`

Add the dispatch branch:

```javascript
if (templateName === 'status_report') return buildStatusReport(input);
```

### 3. `server/routes/copilot.js`

Expand the `template` enum:

```javascript
enum: ['briefing_note', 'analysis_summary', 'governance_paper', 'status_report'],
```

Expand metadata properties to cover `period_covered`, `date_prepared`. The prompt should describe when to pick `status_report` (typically when the user is preparing a periodic update on a function, program, or initiative, where the period covered is a defining element of the artefact).

### 4. No database changes

`status_report` is already a valid `artefact_preference` key from PROF-1 Phase A.

---

## Smoke test result

Sample data covered all five metadata fields and four section blocks with mixed paragraphs and bullets. Renders to a single A4 page for the sample content. All validations passed.
