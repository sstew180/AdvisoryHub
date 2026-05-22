# formal_email template specification

**Status:** Template designed and smoke tested. Ready for Phase C wiring.

**File:** `server/templates/formal-email-gold-coast.docx`

**Reference patterns:** structural outlier among Phase B templates. No section loop, no metadata table. The document body is a copy-paste-ready email plus a small reference block above the divider for the user's own benefit (To, Subject, From values they need when sending in their email client).

---

## Design choices locked in this session

| Dimension | Choice |
| --- | --- |
| Branding | Gold Coast branded (page header chrome only; email body itself is unbranded) |
| Reference block | To + Subject + From above the divider |
| Signature handling | Multi-line array, model fills as many lines as appropriate |
| Page size | A4 |

---

## Placeholder schema

### Reference block (above divider, for the user's reference only)

| Placeholder | Type | Example |
| --- | --- | --- |
| `{to}` | string | "Sarah Patel, Director Corporate Governance" |
| `{subject}` | string | "Procurement threshold review: paper for June ARC" |
| `{from}` | string | "Scott Stewart, Manager Risk and Insurance" |

### Email body (below divider, copy-paste-ready)

| Placeholder | Type | Example |
| --- | --- | --- |
| `{salutation}` | string | "Dear Sarah," |
| `{signoff}` | string | "Kind regards," |

### Loops

```
{#body_paragraphs}{.}{/body_paragraphs}
{#signature}{.}{/signature}
```

Body paragraphs render one paragraph per array entry. Signature lines render one paragraph per array entry, tight-spaced so they look like a contiguous signature block.

---

## Expected data shape for the builder

```javascript
{
  to:              'string',
  subject:         'string',
  from:            'string',
  salutation:      'string',
  body_paragraphs: ['string', ...],
  signoff:         'string',
  signature:       ['string', ...],
}
```

---

## Phase C wiring (to be done in a future session)

### 1. `server/lib/buildWordFromTemplate.js`

Add to `TEMPLATES`:

```javascript
formal_email: 'formal-email-gold-coast.docx',
```

Builder function:

```javascript
async function buildFormalEmail(input) {
  const title = (input && input.title) || 'Formal email';
  const metadata = (input && input.metadata) || {};

  const bodyParagraphs = Array.isArray(input.body_paragraphs)
    ? input.body_paragraphs.filter(p => typeof p === 'string' && p.trim()).map(p => p.trim())
    : [];

  if (bodyParagraphs.length === 0) {
    bodyParagraphs.push('(No body content was generated.)');
  }

  const signature = Array.isArray(input.signature)
    ? input.signature.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim())
    : [];

  const data = {
    to:              coerceText(metadata.to),
    subject:         coerceText(metadata.subject) || title,
    from:            coerceText(metadata.from),
    salutation:      coerceText(input.salutation) || 'Hello,',
    body_paragraphs: bodyParagraphs,
    signoff:         coerceText(input.signoff) || 'Kind regards,',
    signature,
  };

  return renderTemplate('formal_email', data);
}
```

### 2. `server/lib/buildWord.js`

```javascript
if (templateName === 'formal_email') return buildFormalEmail(input);
```

### 3. `server/routes/copilot.js` tool schema

Unlike the other templates, formal_email does not use the `sections` array. Its top-level fields are different. The tool schema branch for formal_email should accept:

```javascript
{
  title:           string,
  template:        'formal_email',
  metadata: {
    to:      string,
    subject: string,
    from:    string,
  },
  salutation:      string,
  body_paragraphs: array of strings,
  signoff:         string,
  signature:       array of strings,
}
```

The model should populate `from` and `signature` from the user's profile (first_name + last_name + organisation + role). The system prompt should guide this.

### 4. No database changes

`formal_email` is already a valid `artefact_preference` key from PROF-1 Phase A.

---

## Smoke test result

Sample data covered all reference fields, four body paragraphs, and a five-line signature block. Output validated. Single A4 page rendering for the sample content, all loops resolved correctly. The "Email body (copy from below)" divider caption renders as intended.
