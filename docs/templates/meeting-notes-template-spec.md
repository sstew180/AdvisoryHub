# meeting_notes template specification

**Status:** Template designed and smoke tested. Ready for Phase C wiring.

**File:** `server/templates/meeting-notes-gold-coast.docx`

**Reference templates:** previous templates use a flat `{#sections}` loop. This template is the first to use **nested loops**, which we needed to capture the structured shape of meeting minutes (attendees, apologies, agenda items where each item has discussion, decisions, and actions sub-loops).

---

## Design choices locked in this session

| Dimension | Choice |
| --- | --- |
| Branding | Gold Coast branded |
| Metadata | Full: Title + Date + Time + Location + Chair + Minute taker + Reference |
| Body structure | Structured with sub-loops |
| Page size | A4 |

---

## Placeholder schema

### Top-level metadata fields

| Placeholder | Type | Example |
| --- | --- | --- |
| `{title}` | string | "Audit and Risk Committee, June 2026" |
| `{date}` | string | "15 June 2026" |
| `{time}` | string | "10:00 AM - 12:00 PM" |
| `{location}` | string | "Council Chambers, Nerang Civic Centre" |
| `{chair}` | string | "Cr Jane Smith" |
| `{minute_taker}` | string | "Scott Stewart, Manager Risk and Insurance" |
| `{reference}` | string | "MN-ARC-2026-06" |

### Attendees list (simple string array)

```
{#attendees}{.}{/attendees}
```

Each entry renders as a bulleted item. `{.}` refers to the current string in the array.

### Apologies list (simple string array)

```
{#apologies}{.}{/apologies}
```

Same pattern as attendees.

### Agenda items (objects with nested sub-loops)

```
{#agenda_items}
  {topic}
  {#discussion}{.}{/discussion}
  {#decisions}{.}{/decisions}
  {#actions} {action} (Owner: {owner}, Due: {due_date}) {/actions}
{/agenda_items}
```

For each agenda item the template renders:

1. The topic as a coloured subheading
2. A "Discussion" subheading + paragraph loop
3. A "Decisions" subheading + bullet loop
4. An "Actions" subheading + bullet loop where each bullet shows the action text followed by Owner and Due date in parentheses (muted colour)

---

## Expected data shape for the builder

```javascript
{
  title:        'string',
  date:         'string',
  time:         'string',
  location:     'string',
  chair:        'string',
  minute_taker: 'string',
  reference:    'string',
  attendees:    ['string', 'string', ...],
  apologies:    ['string', 'string', ...],
  agenda_items: [
    {
      topic: 'string',
      discussion: ['paragraph 1', 'paragraph 2', ...],
      decisions:  ['decision 1', 'decision 2', ...],
      actions: [
        { action: 'string', owner: 'string', due_date: 'string' },
        ...
      ],
    },
    ...
  ],
}
```

This is the most complex data shape of the templates so far. The Phase C builder will need richer normalisation than `normaliseSection` provided for the other templates.

---

## Known limitation: empty subheading rendering

When an agenda item has an empty `discussion`, `decisions`, or `actions` array, the subheading ("Discussion", "Decisions", "Actions") still renders with nothing beneath it. The smoke test confirmed this: Item 2 in the test data had `actions: []`, and the rendered output shows the "Actions" subheading followed by blank space.

This is a docxtemplater limitation. The cleaner fix requires either a conditional block (which can only appear once per loop iteration, complicating the template), or splitting each subsection into a separate conditional template. Neither is worth the complexity for what is a minor cosmetic issue.

**Practical handling:** the user can delete the empty subheading manually in Word if it bothers them. For most meetings, all three sections will be populated. Where a section is genuinely empty (for example a status update agenda item with no actions), the empty heading reads as "place where actions would go if any were required".

---

## Phase C wiring (to be done in a future session)

### 1. `server/lib/buildWordFromTemplate.js`

Add to `TEMPLATES`:

```javascript
meeting_notes: 'meeting-notes-gold-coast.docx',
```

The builder for meeting_notes needs a new normalisation helper because the data shape includes arrays of objects (the actions sub-loop), not just arrays of strings. Suggested helper:

```javascript
function normaliseAgendaItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const topic = typeof raw.topic === 'string' ? raw.topic.trim() : '';
  const discussion = Array.isArray(raw.discussion)
    ? raw.discussion.filter(p => typeof p === 'string' && p.trim()).map(p => p.trim())
    : [];
  const decisions = Array.isArray(raw.decisions)
    ? raw.decisions.filter(d => typeof d === 'string' && d.trim()).map(d => d.trim())
    : [];
  const actions = Array.isArray(raw.actions)
    ? raw.actions
        .filter(a => a && typeof a === 'object')
        .map(a => ({
          action:   coerceText(a.action),
          owner:    coerceText(a.owner),
          due_date: coerceText(a.due_date),
        }))
        .filter(a => a.action) // drop empty actions entirely
    : [];

  if (!topic && discussion.length === 0 && decisions.length === 0 && actions.length === 0) {
    return null;
  }

  return { topic, discussion, decisions, actions };
}
```

Then the builder:

```javascript
async function buildMeetingNotes(input) {
  const title = (input && input.title) || 'Meeting notes';
  const metadata = (input && input.metadata) || {};

  const rawAttendees = Array.isArray(input.attendees) ? input.attendees : [];
  const rawApologies = Array.isArray(input.apologies) ? input.apologies : [];
  const rawAgenda    = Array.isArray(input.agenda_items) ? input.agenda_items : [];

  const attendees = rawAttendees.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim());
  const apologies = rawApologies.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim());
  const agenda_items = rawAgenda.map(normaliseAgendaItem).filter(a => a !== null);

  if (agenda_items.length === 0) {
    agenda_items.push({
      topic: 'Agenda item',
      discussion: ['(No agenda items captured.)'],
      decisions: [],
      actions: [],
    });
  }

  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const data = {
    title:        coerceText(metadata.title) || title,
    date:         coerceText(metadata.date) || today,
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
```

### 2. `server/lib/buildWord.js`

```javascript
if (templateName === 'meeting_notes') return buildMeetingNotes(input);
```

### 3. `server/routes/copilot.js`

Expand the tool schema with rich object structure for `meeting_notes`. The Claude tool schema for actions array needs:

```javascript
agenda_items: {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      topic:      { type: 'string' },
      discussion: { type: 'array', items: { type: 'string' } },
      decisions:  { type: 'array', items: { type: 'string' } },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action:   { type: 'string' },
            owner:    { type: 'string' },
            due_date: { type: 'string' },
          },
          required: ['action'],
        },
      },
    },
    required: ['topic'],
  },
}
```

This is the first template that justifies a per-template tool schema branch, rather than a single shared schema. Worth thinking about in Phase C.

### 4. No database changes

`meeting_notes` is already a valid `artefact_preference` key from PROF-1 Phase A.

---

## Smoke test result

Sample data covered all seven metadata fields, five attendees, two apologies, two agenda items (one with full discussion + decisions + actions, one with empty actions array to test the known limitation). Output validated. Two-page rendering, all loops resolved correctly. Empty actions array renders as the known cosmetic issue documented above.
