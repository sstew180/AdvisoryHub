# Card #271: Embedding Quality Report

Generated: 2026-05-02T12:34:27.487Z

## Summary

| Provider | Avg recall@5 |
|----------|------------:|
| OpenAI text-embedding-3-small | 46.0% |
| Titan Text Embeddings V2 | 48.0% |

Titan relative to OpenAI: **104.3%**
Pass threshold: 80% relative

**Result: PASS**

---

## Per-query Results

| Query | OpenAI | Titan |
|-------|------:|------:|
| Q01 | 60% | 60% |
| Q02 | 60% | 80% |
| Q03 | 20% | 40% |
| Q04 | 60% | 80% |
| Q05 | 20% | 20% |
| Q06 | 20% | 20% |
| Q07 | 20% | 20% |
| Q08 | 20% | 40% |
| Q09 | 20% | 20% |
| Q10 | 40% | 40% |
| Q11 | 60% | 60% |
| Q12 | 80% | 80% |
| Q13 | 40% | 60% |
| Q14 | 60% | 40% |
| Q15 | 60% | 60% |
| Q16 | 80% | 60% |
| Q17 | 40% | 20% |
| Q18 | 40% | 40% |
| Q19 | 60% | 60% |
| Q20 | 60% | 60% |

---

## Detail per Query

### Q01 (legislation lookup)

**Query:** What does the Local Government Act require regarding internal audit?

**Ground truth (Claude judge):**
- extract-lgr-internal-audit
- extract-lga-governance-audit
- skill-internal-audit-program
- globalinternalauditstandards_2024january9_editable
- Effectiveness of audit committees in state government entities (Report 2—2020–21)

**OpenAI top-5 (recall 60%):**
- extract-lgr-internal-audit (0.605) [HIT]
- extract-lga-governance-audit (0.588) [HIT]
- skill-internal-audit-program (0.585) [HIT]
- skill-internal-audit-report (0.571)
- 544946416-PG-Auditing-Anti-Corruption-Activities (0.441)

**Titan top-5 (recall 60%):**
- extract-lgr-internal-audit (0.642) [HIT]
- extract-lga-governance-audit (0.577) [HIT]
- skill-internal-audit-report (0.413)
- skill-internal-audit-program (0.407) [HIT]
- Improving asset management in local government (Report 2–2023–24) (0.354)

### Q02 (skill request)

**Query:** Draft an ARC paper presenting the draft strategic risk register for next quarter's meeting.

**Ground truth (Claude judge):**
- skill-arc-paper
- skill-risk-register
- skill-risk-assessment
- skill-risk-appetite-statement
- skill-risk-dashboard

**OpenAI top-5 (recall 60%):**
- skill-arc-paper (0.635) [HIT]
- skill-committee-paper (0.562)
- skill-risk-register (0.550) [HIT]
- skill-risk-dashboard (0.541) [HIT]
- skill-risk-management-framework (0.515)

**Titan top-5 (recall 80%):**
- skill-arc-paper (0.458) [HIT]
- skill-risk-register (0.423) [HIT]
- skill-committee-paper (0.378)
- skill-risk-dashboard (0.368) [HIT]
- skill-risk-assessment (0.347) [HIT]

### Q03 (operational scenario)

**Query:** We are seeing repeated audit findings on procurement card use. How do I structure a remediation plan?

**Ground truth (Claude judge):**
- skill-audit-finding
- skill-internal-audit-program
- skill-internal-audit-report
- QAO Fact sheet—Internal control assessments from 2021
- procurement-policy

**OpenAI top-5 (recall 20%):**
- skill-audit-finding (0.540) [HIT]
- skill-contract-escalation (0.452)
- skill-diagnostic-review (0.445)
- onegovernmentcontractmanagementframework (0.442)
- skill-procurement-justification (0.440)

**Titan top-5 (recall 40%):**
- skill-audit-finding (0.367) [HIT]
- skill-internal-audit-program (0.362) [HIT]
- procurementguidesuppliersperformance (0.324)
- skill-diagnostic-review (0.312)
- skill-procurement-justification (0.310)

### Q04 (framework)

**Query:** Help me build a risk appetite statement for a council facing rising cyber risk exposure.

**Ground truth (Claude judge):**
- skill-risk-appetite-statement
- skill-risk-management-framework
- ISO-31000-2018-Risk-Management-Definitions-in-Plain-English
- skill-basic-risk-assessment
- skill-risk-register

**OpenAI top-5 (recall 60%):**
- skill-risk-assessment (0.620)
- skill-risk-appetite-statement (0.600) [HIT]
- skill-basic-risk-assessment (0.589) [HIT]
- skill-risk-identification-escalation (0.564)
- skill-risk-management-framework (0.543) [HIT]

**Titan top-5 (recall 80%):**
- skill-risk-appetite-statement (0.591) [HIT]
- skill-risk-assessment (0.444)
- skill-basic-risk-assessment (0.414) [HIT]
- skill-risk-management-framework (0.382) [HIT]
- skill-risk-register (0.340) [HIT]

### Q05 (operational scenario)

**Query:** How should I respond to a Queensland Audit Office finding that our risk register lacks consequence ratings?

**Ground truth (Claude judge):**
- skill-risk-register
- skill-audit-finding
- QAO Fact sheet—Internal control assessments from 2021
- Risk management – where do we start_ _ Queensland Audit Office
- ISO-31000-2018-Risk-Management-Definitions-in-Plain-English

**OpenAI top-5 (recall 20%):**
- skill-risk-register (0.645) [HIT]
- skill-basic-risk-assessment (0.635)
- skill-risk-identification-escalation (0.632)
- skill-risk-framework-maturity (0.607)
- skill-risk-dashboard (0.581)

**Titan top-5 (recall 20%):**
- skill-risk-register (0.583) [HIT]
- fraud_risk_management_report_6-2017-18 (0.481)
- skill-basic-risk-assessment (0.440)
- skill-risk-assessment (0.425)
- skill-complaint-response (0.392)

### Q06 (legislation lookup)

**Query:** What thresholds trigger a formal tender process under LGR Chapter 6?

**Ground truth (Claude judge):**
- extract-lga-lgr-procurement
- procurement-policy
- skill-procurement-justification
- queensland-procurement-policy-2023
- qld-gov-procurement-policy-2026-accessible

**OpenAI top-5 (recall 20%):**
- extract-lga-lgr-procurement (0.579) [HIT]
- major-conditions-of-offer-september-2023 (0.552)
- short-form-conditions-of-offer-june-2022 (0.534)
- skill-contract-escalation (0.488)
- skill-contract-risk-review (0.471)

**Titan top-5 (recall 20%):**
- extract-lga-lgr-procurement (0.409) [HIT]
- short-form-conditions-of-offer-june-2022 (0.314)
- major-conditions-of-offer-september-2023 (0.278)
- skill-terms-of-engagement (0.264)
- skill-contract-escalation (0.252)

### Q07 (operational scenario)

**Query:** A contractor has requested a 12 percent variation on an existing supply contract. What approvals do I need and what is the audit trail?

**Ground truth (Claude judge):**
- skill-contract-variations
- extract-lga-lgr-procurement
- procurement-policy
- onegovernmentcontractmanagementframework
- act-2017-043

**OpenAI top-5 (recall 20%):**
- skill-contract-variations (0.545) [HIT]
- skill-contract-escalation (0.460)
- short-form-conditions-of-offer-june-2022 (0.459)
- skill-contract-risk-review (0.451)
- skill-procedure-writing (0.445)

**Titan top-5 (recall 20%):**
- skill-contract-variations (0.579) [HIT]
- short-form-conditions-of-offer-june-2022 (0.447)
- skill-supplier-performance-review (0.400)
- skill-procurement-justification (0.392)
- skill-contract-escalation (0.386)

### Q08 (skill request)

**Query:** Draft a contract variation memo for the Director of Infrastructure recommending approval.

**Ground truth (Claude judge):**
- skill-contract-variations
- skill-complex-services-contract
- onegovernmentcontractmanagementframework
- extract-lga-lgr-procurement
- skill-executive-briefing

**OpenAI top-5 (recall 20%):**
- skill-contract-variations (0.486) [HIT]
- skill-contract-management-plan (0.471)
- skill-procedure-writing (0.451)
- conditions-contract-provision-asset-maintenance-may-2022 (0.449)
- skill-contract-risk-review (0.443)

**Titan top-5 (recall 40%):**
- skill-contract-variations (0.569) [HIT]
- short-form-conditions-of-offer-june-2022 (0.426)
- skill-contract-management-plan (0.398)
- onegovernmentcontractmanagementframework (0.335) [HIT]
- skill-budget-variance (0.334)

### Q09 (framework)

**Query:** How do I structure a strategic procurement evaluation matrix for a complex services tender?

**Ground truth (Claude judge):**
- Planning-for-significant-procurement
- Probity-integrity-procurement
- extract-lga-lgr-procurement
- qld-gov-procurement-policy-2026-accessible
- queensland-procurement-policy-2023

**OpenAI top-5 (recall 20%):**
- skill-complex-services-contract (0.549)
- skill-procurement-justification (0.517)
- Planning-for-significant-procurement (0.490) [HIT]
- skill-supplier-performance-review (0.480)
- procurementguidesuppliersperformance (0.455)

**Titan top-5 (recall 20%):**
- skill-complex-services-contract (0.495)
- skill-procurement-justification (0.440)
- Planning-for-significant-procurement (0.420) [HIT]
- onegovernmentcontractmanagementframework (0.410)
- cases (0.380)

### Q10 (legislation, edge)

**Query:** How does the City of Gold Coast strategic contracting procedure differ from the default LGR contracting procedures?

**Ground truth (Claude judge):**
- extract-lga-lgr-procurement
- procurement-policy
- act-2017-043
- qld-gov-procurement-policy-2026-accessible
- queensland-procurement-policy-2023

**OpenAI top-5 (recall 40%):**
- extract-lga-lgr-procurement (0.646) [HIT]
- procurement-policy (0.617) [HIT]
- skill-contract-risk-review (0.586)
- skill-contract-management-plan (0.545)
- skill-submission-to-government (0.541)

**Titan top-5 (recall 40%):**
- extract-lga-lgr-procurement (0.598) [HIT]
- procurement-policy (0.501) [HIT]
- conditions-of-contract-short-form-goods-services-june-2022 (0.444)
- Governance Framework_Service Catalogue (0.413)
- skill-complex-services-contract (0.332)

### Q11 (skill request)

**Query:** Draft a briefing note to the CEO explaining the impact of a delayed major capital project.

**Ground truth (Claude judge):**
- skill-briefing-note
- skill-executive-briefing
- skill-project-status-report
- projects
- skill-budget-variance

**OpenAI top-5 (recall 60%):**
- skill-executive-briefing (0.582) [HIT]
- skill-project-status-report (0.539) [HIT]
- skill-briefing-note (0.534) [HIT]
- business-case (0.527)
- skill-ministerial-briefing (0.518)

**Titan top-5 (recall 60%):**
- skill-executive-briefing (0.464) [HIT]
- skill-briefing-note (0.430) [HIT]
- skill-project-status-report (0.424) [HIT]
- executive-communication (0.395)
- skill-presenting-to-executives (0.384)

### Q12 (skill, structural)

**Query:** How should an executive summary for a board paper be structured for maximum impact?

**Ground truth (Claude judge):**
- skill-arc-paper
- skill-committee-paper
- skill-executive-briefing
- executive-communication
- skill-presenting-to-executives

**OpenAI top-5 (recall 80%):**
- skill-committee-paper (0.548) [HIT]
- executive-communication (0.540) [HIT]
- skill-presenting-to-executives (0.533) [HIT]
- skill-executive-briefing (0.517) [HIT]
- skill-briefing-note (0.517)

**Titan top-5 (recall 80%):**
- executive-communication (0.547) [HIT]
- skill-executive-briefing (0.512) [HIT]
- skill-presenting-to-executives (0.497) [HIT]
- skill-committee-paper (0.455) [HIT]
- skill-briefing-note (0.407)

### Q13 (framework)

**Query:** Help me structure a stakeholder analysis for an internal service review.

**Ground truth (Claude judge):**
- skill-stakeholder-consultation
- skill-service-review
- skill-diagnostic-review
- skill-terms-of-reference
- raci

**OpenAI top-5 (recall 40%):**
- skill-diagnostic-review (0.542) [HIT]
- skill-service-review (0.536) [HIT]
- skill-organisational-change (0.490)
- skill-performance-review (0.488)
- QAO Asset management maturity model_0 (0.480)

**Titan top-5 (recall 60%):**
- skill-service-review (0.439) [HIT]
- skill-diagnostic-review (0.410) [HIT]
- skill-stakeholder-consultation (0.408) [HIT]
- strategy (0.386)
- skill-supplier-performance-review (0.344)

### Q14 (skill, council-specific)

**Query:** Draft a one-page council paper proposing a governance reform to delegations.

**Ground truth (Claude judge):**
- skill-delegation-instrument
- skill-committee-paper
- skill-terms-of-reference
- skill-policy-writing
- extract-lga-governance-audit

**OpenAI top-5 (recall 60%):**
- skill-delegation-instrument (0.534) [HIT]
- skill-committee-paper (0.526) [HIT]
- skill-organisational-change (0.503)
- skill-arc-paper (0.453)
- skill-terms-of-reference (0.451) [HIT]

**Titan top-5 (recall 40%):**
- skill-committee-paper (0.527) [HIT]
- skill-organisational-change (0.417)
- skill-submission-to-government (0.415)
- skill-briefing-note (0.381)
- skill-policy-writing (0.379) [HIT]

### Q15 (operational)

**Query:** What is the best structure for a council report when presenting a recommendation to councillors?

**Ground truth (Claude judge):**
- skill-committee-paper
- skill-executive-briefing
- skill-presenting-to-executives
- skill-recommendations-report
- skill-arc-paper

**OpenAI top-5 (recall 60%):**
- skill-recommendations-report (0.652) [HIT]
- skill-presenting-to-executives (0.574) [HIT]
- skill-committee-paper (0.564) [HIT]
- skill-briefing-note (0.553)
- skill-internal-audit-report (0.534)

**Titan top-5 (recall 60%):**
- skill-recommendations-report (0.659) [HIT]
- skill-committee-paper (0.563) [HIT]
- skill-submission-to-government (0.516)
- skill-presenting-to-executives (0.500) [HIT]
- skill-briefing-note (0.484)

### Q16 (cross-domain crisis)

**Query:** We have had a probity breach on a tender involving a senior officer. What is my immediate response?

**Ground truth (Claude judge):**
- skill-probity-decision
- Probity-integrity-procurement
- Fraud-and-Corruption-Control-Best-Practice-Guide-2018
- skill-conflict-of-interest
- skill-workplace-investigation

**OpenAI top-5 (recall 80%):**
- skill-probity-decision (0.535) [HIT]
- Probity-integrity-procurement (0.467) [HIT]
- skill-conflict-of-interest (0.466) [HIT]
- skill-workplace-investigation (0.465) [HIT]
- skill-difficult-employee (0.442)

**Titan top-5 (recall 60%):**
- skill-probity-decision (0.430) [HIT]
- Probity-integrity-procurement (0.384) [HIT]
- reference-contract-law-principles (0.299)
- skill-workplace-investigation (0.245) [HIT]
- skill-complaint-response (0.237)

### Q17 (semantic, simple)

**Query:** What is the difference between a risk and an issue?

**Ground truth (Claude judge):**
- ISO-31000-2018-Risk-Management-Definitions-in-Plain-English
- 460452430-31000-2018-in-Plain-English-S2-19-Published-1580800433395-docx
- 649646265-ISO-31073-Risk-management-Vocabulary-moving-from-ISO-Guide-73-version-2009-to-ISO-31070-versio-2022
- Guide-to-Risk-Management-June-2020
- skill-risk-management-framework

**OpenAI top-5 (recall 40%):**
- ISO-31000-2018-Risk-Management-Definitions-in-Plain-English (0.525) [HIT]
- 460452430-31000-2018-in-Plain-English-S2-19-Published-1580800433395-docx (0.503) [HIT]
- skill-risk-assessment (0.458)
- 424572924-ISO-31010-New-Standards-for-Risk-Managament (0.448)
- skill-risk-identification-escalation (0.441)

**Titan top-5 (recall 20%):**
- ISO-31000-2018-Risk-Management-Definitions-in-Plain-English (0.365) [HIT]
- 424572924-ISO-31010-New-Standards-for-Risk-Managament (0.334)
- skill-basic-risk-assessment (0.332)
- skill-risk-assessment (0.318)
- Risk management – where do we start_ _ Queensland Audit Office (0.296)

### Q18 (cross-domain operational)

**Query:** A contract overrun has triggered a budget variance. Who approves the variation and what audit trail is required?

**Ground truth (Claude judge):**
- skill-contract-variations
- skill-budget-variance
- extract-lga-lgr-procurement
- onegovernmentcontractmanagementframework
- extract-lgr-internal-audit

**OpenAI top-5 (recall 40%):**
- skill-budget-variance (0.529) [HIT]
- skill-contract-variations (0.523) [HIT]
- skill-contract-escalation (0.436)
- skill-procedure-writing (0.431)
- skill-contract-risk-review (0.409)

**Titan top-5 (recall 40%):**
- skill-budget-variance (0.592) [HIT]
- skill-contract-variations (0.512) [HIT]
- skill-business-unit-budget (0.347)
- skill-read-financial-report (0.330)
- skill-procurement-justification (0.319)

### Q19 (meta-action, low-similarity)

**Query:** Review my draft risk register and suggest improvements.

**Ground truth (Claude judge):**
- skill-risk-register
- skill-basic-risk-assessment
- ISO-31000-2018-Risk-Management-Definitions-in-Plain-English
- Guide-to-Risk-Management-June-2020
- skill-risk-assessment

**OpenAI top-5 (recall 60%):**
- skill-risk-register (0.563) [HIT]
- skill-basic-risk-assessment (0.548) [HIT]
- skill-risk-assessment (0.546) [HIT]
- skill-risk-identification-escalation (0.536)
- skill-contract-risk-enhanced (0.504)

**Titan top-5 (recall 60%):**
- skill-risk-register (0.558) [HIT]
- skill-risk-dashboard (0.410)
- skill-basic-risk-assessment (0.395) [HIT]
- skill-risk-assessment (0.390) [HIT]
- skill-contract-risk-review (0.362)

### Q20 (cross-domain governance)

**Query:** Our internal auditor wants assurance over the 2026 procurement program. What governance documents should they review?

**Ground truth (Claude judge):**
- extract-lga-lgr-procurement
- qld-gov-procurement-policy-2026-accessible
- skill-internal-audit-program
- procurement-policy
- Probity-integrity-procurement

**OpenAI top-5 (recall 60%):**
- skill-internal-audit-program (0.541) [HIT]
- globalinternalauditstandards_2024january9_editable (0.521)
- qld-gov-procurement-policy-2026-accessible (0.513) [HIT]
- skill-probity-decision (0.509)
- procurement-policy (0.506) [HIT]

**Titan top-5 (recall 60%):**
- skill-internal-audit-program (0.492) [HIT]
- qld-gov-procurement-policy-2026-accessible (0.415) [HIT]
- Probity-integrity-procurement (0.394) [HIT]
- Planning-for-significant-procurement (0.387)
- procurementguidesuppliersperformance (0.386)
