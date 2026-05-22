# options_analysis template specification

**Status:** Template designed and smoke tested. Ready for Phase C wiring.

**File:** `server/templates/options-analysis-gold-coast.docx`

**Reference patterns:** combines the flexible `{#sections}` loop (from analysis_summary, governance_paper, status_report) with a dedicated structured sub-loop pattern (proven in meeting_notes).

---

## Design choices locked in this session

| Dimension | Choice |
| --- | --- |
| Branding | Gold Coast branded |
| Metadata | Medium: Title + Author + Date + Reference + Decision sought |
| Body structure | Flexible sections + options sub-loop |
| Page size | A4 |

---

## Placeholder schema

### Top-level metadata fields

| Placeholder | Type | Example |
| --- | --- | --- |
| `{title}` | string | "Corporate Insurance Program: FY2027 Renewal Options" |
| `{author}` | string | "Scott Stewart, Manager Risk and Insurance" |
| `{date}` | string | "21 May 2026" |
| `{reference}` | string | "OA-RI-2026-03" |
| `{decision_sought}` | string | "Which renewal pathway should Council pursue for FY2027?" |

### Flexible sections loop

```
{#sections}
  {heading}
  {#paragraphs}{.}{/paragraphs}
  {#bullets}{.}{/bullets}
{/sections}
```

Same shape as analysis_summary and governance_paper. The `preferenceMap.js` instruction for `options_analysis` should suggest sections like Context, Evaluation criteria, Analysis, Recommendation. The per-option detail does NOT go here; it goes in the options sub-loop below.

### Options sub-loop

```
{#options}
  {name}
  {description}
  {#strengths}{.}{/strengths}
  {#weaknesses}{.}{/weaknesses}
{/options}
```

The section heading "Options considered" renders unconditionally; each option then renders as a sub-block with name + description + strengths bullets + weaknesses bullets.

---

## Expected data shape for the builder

```javascript
{
  title:           'string',
  author:          'string',
  date:            'string',
  reference:       'string',
  decision_sought: 'string',
  sections: [
    {
      heading: 'string',
      paragraphs: ['string', ...],
      bullets:    ['string', ...],
    },
    ...
  ],
  options: [
    {
      name:        'string',
      description: 'string',
      strengths:   ['string', ...],
      weaknesses:  ['string', ...],
    },
    ...
  ],
}
```

---

## Document flow

The template fixes the order as: sections first, then options. The rationale is that sections cover the narrative arc (Context, Criteria, Analysis, Recommendation), and the options sub-loop provides supporting per-option detail at the end. This matches the Bottom Line Up Front pattern: the reader sees the recommendation before drilling into option-by-option detail.

If a "pre-amble" narrative is needed before options are detailed, the model can include it in the Analysis section. If the model wants to describe options narratively before the structured block, that also goes in the Analysis section.

---

## Known limitation: empty section subheadings

Same caveat as meeting_notes. If an option has an empty `strengths` or `weaknesses` array, the subheading still renders with nothing beneath it. Documented, accepted, user can clean up manually if needed.

---

## Phase C wiring (to be done in a future session)

### 1. `server/lib/buildWordFromTemplate.js`

Add to `TEMPLATES`:

```javascript
options_analysis: 'options-analysis-gold-coast.docx',
```

Builder function:

```javascript
function normaliseOption(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const strengths = Array.isArray(raw.strengths)
    ? raw.strengths.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim())
    : [];
  const weaknesses = Array.isArray(raw.weaknesses)
    ? raw.weaknesses.filter(w => typeof w === 'string' && w.trim()).map(w => w.trim())
    : [];

  if (!name && !description && strengths.length === 0 && weaknesses.length === 0) {
    return null;
  }

  return { name, description, strengths, weaknesses };
}

async function buildOptionsAnalysis(input) {
  const title = (input && input.title) || 'Options analysis';
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

  const rawOptions = Array.isArray(input.options) ? input.options : [];
  const options = rawOptions.map(normaliseOption).filter(o => o !== null);
  if (options.length === 0) {
    options.push({
      name:        'Option 1',
      description: '(No options were generated.)',
      strengths:   [],
      weaknesses:  [],
    });
  }

  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const data = {
    title:           coerceText(metadata.title) || title,
    author:          coerceText(metadata.author),
    date:            coerceText(metadata.date) || today,
    reference:       coerceText(metadata.reference),
    decision_sought: coerceText(metadata.decision_sought),
    sections,
    options,
  };

  return renderTemplate('options_analysis', data);
}
```

### 2. `server/lib/buildWord.js`

```javascript
if (templateName === 'options_analysis') return buildOptionsAnalysis(input);
```

### 3. `server/routes/copilot.js` tool schema

The schema needs both `sections` and `options` arrays. The `options` items have rich structure:

```javascript
options: {
  type: 'array',
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
}
```

The prompt prose should describe when to pick `options_analysis` (when the user is comparing two or more alternatives against criteria, and the document's purpose is to inform an option-selection decision).

### 4. No database changes

`options_analysis` is already a valid `artefact_preference` key from PROF-1 Phase A.

---

## Smoke test result

Sample data covered all five metadata fields, four flexible sections (mix of paragraphs and bullets), and three options each with description and full strengths/weaknesses arrays. Output validated. Two-page rendering, all loops resolved correctly.
