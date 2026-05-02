# Card #271: Embedding Quality Test Queries

**Purpose**: 20 queries used to compare OpenAI text-embedding-3-small vs Titan V2 retrieval on the AdvisoryHub library (176 docs).

**Ground truth method**: For each query, manually identify the 5 documents in `library_documents` that *should* appear in top 5. Compute recall@5 per provider against ground truth.

**Pass criterion**: Titan recall@5 must be at least 80% of OpenAI recall@5.

---

## Risk and Audit (5)

### Q01 (legislation lookup)
What does the Local Government Act require regarding internal audit?

*Notes: Should hit LGA s105 extract. Tests precise legislative retrieval.*

### Q02 (skill request)
Draft an ARC paper presenting the draft strategic risk register for next quarter's meeting.

*Notes: Meta-action query. ARC = Audit and Risk Committee. Tests skill-arc-paper retrieval plus risk-register framework.*

### Q03 (operational scenario)
We are seeing repeated audit findings on procurement card use. How do I structure a remediation plan?

*Notes: Should hit QAO better practice, audit-finding skill, internal control framework docs.*

### Q04 (framework)
Help me build a risk appetite statement for a council facing rising cyber risk exposure.

*Notes: Tests ISO 31000 framework retrieval plus risk-appetite skill.*

### Q05 (operational scenario)
How should I respond to a Queensland Audit Office finding that our risk register lacks consequence ratings?

*Notes: Tests QAO better practice guides plus consequence-rating methodology.*

---

## Contract Management (5)

### Q06 (legislation lookup)
What thresholds trigger a formal tender process under LGR Chapter 6?

*Notes: Should hit LGR ss224, 228, 234 extracts. Tests precise legislative retrieval.*

### Q07 (operational scenario)
A contractor has requested a 12 percent variation on an existing supply contract. What approvals do I need and what is the audit trail?

*Notes: Tests variation-management skill plus delegations framework.*

### Q08 (skill request)
Draft a contract variation memo for the Director of Infrastructure recommending approval.

*Notes: Meta-action query. Tests skill-contract-variation-memo plus briefing-note skill.*

### Q09 (framework)
How do I structure a strategic procurement evaluation matrix for a complex services tender?

*Notes: Tests procurement-evaluation framework plus consulting frameworks library.*

### Q10 (legislation, edge)
How does the City of Gold Coast strategic contracting procedure differ from the default LGR contracting procedures?

*Notes: Tests Gold Coast specific content plus LGR Chapter 6 Part 2 extracts. Specific to reference deployment.*

---

## General / Professional Practice (5)

### Q11 (skill request)
Draft a briefing note to the CEO explaining the impact of a delayed major capital project.

*Notes: Tests briefing-note skill plus delay-impact framework.*

### Q12 (skill, structural)
How should an executive summary for a board paper be structured for maximum impact?

*Notes: Tests board-paper skill plus executive-summary framework.*

### Q13 (framework)
Help me structure a stakeholder analysis for an internal service review.

*Notes: Tests stakeholder-analysis framework plus service-review skill.*

### Q14 (skill, council-specific)
Draft a one-page council paper proposing a governance reform to delegations.

*Notes: Tests council-paper skill plus delegations framework. Council paper is distinct from board paper format.*

### Q15 (operational)
What is the best structure for a council report when presenting a recommendation to councillors?

*Notes: Similar to Q14 but operational framing. Tests recall robustness across query phrasings.*

---

## Cross-domain / Edge-case (5)

### Q16 (cross-domain crisis)
We have had a probity breach on a tender involving a senior officer. What is my immediate response?

*Notes: Touches risk, audit, contracts, governance, CCC. Tests retrieval breadth across domains.*

### Q17 (semantic, simple)
What is the difference between a risk and an issue?

*Notes: Short query, tests semantic precision. Should hit risk-management framework basics, not contract or audit docs.*

### Q18 (cross-domain operational)
A contract overrun has triggered a budget variance. Who approves the variation and what audit trail is required?

*Notes: Crosses contracts and audit and financial delegations.*

### Q19 (meta-action, low-similarity)
Review my draft risk register and suggest improvements.

*Notes: Asks ABOUT a document rather than for its content. Embeddings score lower for meta-actions. Tests retrieval at the difficult end (matches the chat.js Card #262 tuning rationale).*

### Q20 (cross-domain governance)
Our internal auditor wants assurance over the 2026 procurement program. What governance documents should they review?

*Notes: Crosses audit, contracts, and program governance. Tests retrieval of multiple framework types in one query.*

---

## Ground truth annotation template

Fill this in after Scott's sanity check on Q01-Q20. Five document IDs per query.

| Query | Truth Doc 1 | Truth Doc 2 | Truth Doc 3 | Truth Doc 4 | Truth Doc 5 |
|-------|-------------|-------------|-------------|-------------|-------------|
| Q01   |             |             |             |             |             |
| Q02   |             |             |             |             |             |
| Q03   |             |             |             |             |             |
| Q04   |             |             |             |             |             |
| Q05   |             |             |             |             |             |
| Q06   |             |             |             |             |             |
| Q07   |             |             |             |             |             |
| Q08   |             |             |             |             |             |
| Q09   |             |             |             |             |             |
| Q10   |             |             |             |             |             |
| Q11   |             |             |             |             |             |
| Q12   |             |             |             |             |             |
| Q13   |             |             |             |             |             |
| Q14   |             |             |             |             |             |
| Q15   |             |             |             |             |             |
| Q16   |             |             |             |             |             |
| Q17   |             |             |             |             |             |
| Q18   |             |             |             |             |             |
| Q19   |             |             |             |             |             |
| Q20   |             |             |             |             |             |

---

*Card #271 reference asset. Permanent test set, not throwaway.*
