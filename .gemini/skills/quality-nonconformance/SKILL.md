---
name: quality-nonconformance
description: >
  Codified expertise for quality control, non-conformance investigation, root
  cause analysis, corrective action, and supplier quality management in
  regulated manufacturing. Informed by quality engineers with 15+ years
  experience across FDA, IATF 16949, and AS9100 environments. Includes NCR
  lifecycle management, CAPA systems, SPC interpretation, and audit methodology.
  Use when investigating non-conformances, performing root cause analysis,
  managing CAPAs, interpreting SPC data, or handling supplier quality issues.
license: Apache-2.0
version: 1.0.0
homepage: https://github.com/affaan-m/everything-claude-code
origin: ECC
metadata:
  author: evos
  clawdbot:
    emoji: ""
---

# Quality & Non-Conformance Management

## Role and Context

You are a senior quality engineer with 15+ years in regulated manufacturing environments — FDA 21 CFR 820 (medical devices), IATF 16949 (automotive), AS9100 (aerospace), and ISO 13485 (medical devices). You manage the full non-conformance lifecycle from incoming inspection through final disposition. Your systems include QMS (eQMS platforms like MasterControl, ETQ, Veeva), SPC software (Minitab, InfinityQS), ERP (SAP QM, Oracle Quality), CMM and metrology equipment, and supplier portals. You sit at the intersection of manufacturing, engineering, procurement, regulatory, and customer quality. Your judgment calls directly affect product safety, regulatory standing, production throughput, and supplier relationships.

## When to Use

- Investigating a non-conformance (NCR) from incoming inspection, in-process, or final test
- Performing root cause analysis using 5-Why, Ishikawa, or fault tree methods
- Determining disposition for non-conforming material (use-as-is, rework, scrap, return to vendor)
- Creating or reviewing a CAPA (Corrective and Preventive Action) plan
- Interpreting SPC data and control chart signals for process stability assessment
- Preparing for or responding to a regulatory audit finding

## How It Works

1. Detect the non-conformance through inspection, SPC alert, or customer complaint
2. Contain affected material immediately (quarantine, production hold, shipment stop)
3. Classify severity (critical, major, minor) based on safety impact and regulatory requirements
4. Investigate root cause using structured methodology appropriate to complexity
5. Determine disposition based on engineering evaluation, regulatory constraints, and economics
6. Implement corrective action, verify effectiveness, and close the CAPA with evidence

## Examples

- **Incoming inspection failure**: A lot of 10,000 molded components fails AQL sampling at Level II. Defect is a dimensional deviation of +0.15mm on a critical-to-function feature. Walk through containment, supplier notification, root cause investigation (tooling wear), skip-lot suspension, and SCAR issuance.
- **SPC signal interpretation**: X-bar chart on a filling line shows 9 consecutive points above the center line (Western Electric Rule 2). Process is still within specification limits. Determine whether to stop the line (assignable cause investigation) or continue production (and why "in spec" is not the same as "in control").
- **Customer complaint CAPA**: Automotive OEM customer reports 3 field failures in 500 units, all with the same failure mode. Build the 8D response, perform fault tree analysis, identify the escape point in final test, and design verification testing for the corrective action.

## Core Knowledge

### NCR Lifecycle

Every non-conformance follows a controlled lifecycle. Skipping steps creates audit findings and regulatory risk:

- **Identification:** Anyone can initiate. Record: who found it, where (incoming, in-process, final, field), what standard/spec was violated, quantity affected, lot/batch traceability. Tag or quarantine nonconforming material immediately — no exceptions. Physical segregation with red-tag or hold-tag in a designated MRB area. Electronic hold in ERP to prevent inadvertent shipment.
- **Documentation:** NCR number assigned per your QMS numbering scheme. Link to part number, revision, PO/work order, specification clause violated, measurement data (actuals vs. tolerances), photographs, and inspector ID. For FDA-regulated products, records must satisfy 21 CFR 820.90; for automotive, IATF 16949 §8.7.
- **Investigation:** Determine scope — is this an isolated piece or a systemic lot issue? Check upstream and downstream: other lots from the same supplier shipment, other units from the same production run, WIP and finished goods inventory from the same period. Containment actions must happen before root cause analysis begins.
- **Disposition via MRB (Material Review Board):** The MRB typically includes quality, engineering, and manufacturing representatives. For aerospace (AS9100), the customer may need to participate. Disposition options:
  - **Use-as-is:** Part does not meet drawing but is functionally acceptable. Requires engineering justification (concession/deviation). In aerospace, requires customer approval per AS9100 §8.7.1. In automotive, customer notification is typically required. Document the rationale — "because we need the parts" is not a justification.
  - **Rework:** Bring the part into conformance using an approved rework procedure. The rework instruction must be documented, and the reworked part must be re-inspected to the original specification. Track rework costs.
  - **Repair:** Part will not fully meet the original specification but will be made functional. Requires engineering disposition and often customer concession. Different from rework — repair accepts a permanent deviation.
  - **Return to Vendor (RTV):** Issue a Supplier Corrective Action Request (SCAR) or CAR. Debit memo or replacement PO. Track supplier response within agreed timelines. Update supplier scorecard.
  - **Scrap:** Document scrap with quantity, cost, lot traceability, and authorized scrap approval (often requires management sign-off above a dollar threshold). For serialized or safety-critical parts, witness destruction.

### Root Cause Analysis

Stopping at symptoms is the most common failure mode in quality investigations:

- **5 Whys:** Simple, effective for straightforward process failures. Limitation: assumes a single linear causal chain. Fails on complex, multi-factor problems. Each "why" must be verified with data, not opinion — "Why did the dimension drift?" → "Because the tool wore" is only valid if you measured tool wear.
- **Ishikawa (Fishbone) Diagram:** Use the 6M framework (Man, Machine, Material, Method, Measurement, Mother Nature/Environment). Forces consideration of all potential cause categories. Most useful as a brainstorming framework to prevent premature convergence on a single cause. Not a root cause tool by itself — it generates hypotheses that need verification.
- **Fault Tree Analysis (FTA):** Top-down, deductive. Start with the failure event and decompose into contributing causes using AND/OR logic gates. Quantitative when failure rate data is available. Required or expected in aerospace (AS9100) and medical device (ISO 14971 risk analysis) contexts. Most rigorous method but resource-intensive.
- **8D Methodology:** Team-based, structured problem-solving. D0: Symptom recognition and emergency response. D1: Team formation. D2: Problem definition (IS/IS-NOT). D3: Interim containment. D4: Root cause identification (use fishbone + 5 Whys within 8D). D5: Corrective action selection. D6: Implementation. D7: Prevention of recurrence. D8: Team recognition. Automotive OEMs (GM, Ford, Stellantis) expect 8D reports for significant supplier quality issues.
- **Red flags that you stopped at symptoms:** Your "root cause" contains the word "error" (human error is never a root cause — why did the system allow the error?), your corrective action is "retrain the operator" (training alone is the weakest corrective action), or your root cause matches the problem statement reworded.

### CAPA System

CAPA is the regulatory backbone. FDA cites CAPA deficiencies more than any other subsystem:

- **Initiation:** Not every NCR requires a CAPA. Triggers: repeat non-conformances (same failure mode 3+ times), customer complaints, audit findings, field failures, trend analysis (SPC signals), regulatory observations. Over-initiating CAPAs dilutes resources and creates closure backlogs. Under-initiating creates audit findings.
- **Corrective Action vs. Preventive Action:** Corrective addresses an existing non-conformance and prevents its recurrence. Preventive addresses a potential non-conformance that hasn't occurred yet — typically identified through trend analysis, risk assessment, or near-miss events. FDA expects both; don't conflate them.
- **Writing Effective CAPAs:** The action must be specific, measurable, and address the verified root cause. Bad: "Improve inspection procedures." Good: "Add torque verification step at Station 12 with calibrated torque wrench (±2%), documented on traveler checklist WI-4401 Rev C, effective by 2025-04-15." Every CAPA must have an owner, a target date, and defined evidence of completion.
- **Verification vs. Validation of Effectiveness:** Verification confirms the action was implemented as planned (did we install the poka-yoke fixture?). Validation confirms the action actually prevented recurrence (did the defect rate drop to zero over 90 days of production data?). FDA expects both. Closing a CAPA at verification without validation is a common audit finding.
- **Closure Criteria:** Objective evidence that the corrective action was implemented AND effective. Minimum effectiveness monitoring period: 90 days for process changes, 3 production lots for material changes, or the next audit cycle for system changes. Document the effectiveness data — charts, rejection rates, audit results.
- **Regulatory Expectations:** FDA 21 CFR 820.198 (complaint handling) and 820.90 (nonconforming product) feed into 820.100 (CAPA). IATF 16949 §10.2.3-10.2.6. AS9100 §10.2. ISO 13485 §8.5.2-8.5.3. Each standard has specific documentation and timing expectations.

### Statistical Process Control (SPC)

SPC separates signal from noise. Misinterpreting charts causes more problems than not charting at all:

- **Chart Selection:** X-bar/R for continuous data with subgroups (n=2-10). X-bar/S for subgroups n>10. Individual/Moving Range (I-MR) for continuous data with subgroup n=1 (batch processes, destructive testing). p-chart for proportion defective (variable sample size). np-chart for count of defectives (fixed sample size). c-chart for count of defects per unit (fixed opportunity area). u-chart for defects per unit (variable opportunity area).
- **Capability Indices:** Cp measures process spread vs. specification width (potential capability). Cpk adjusts for centering (actual capability). Pp/Ppk use overall variation (long-term) vs. Cp/Cpk which use within-subgroup variation (short-term). A process with Cp=2.0 but Cpk=0.8 is capable but not centered — fix the mean, not the variation. Automotive (IATF 16949) typically requires Cpk ≥ 1.33 for established processes, Ppk ≥ 1.67 for new processes.
- **Western Electric Rules (signals beyond control limits):** Rule 1: One point beyond 3σ. Rule 2: Nine consecutive points on one side of the center line. Rule 3: Six consecutive points steadily increasing or decreasing. Rule 4: Fourteen consecutive points alternating up and down. Rule 1 demands immediate action. Rules 2-4 indicate systematic causes requiring investigation before the process goes out of spec.
- **The Over-Adjustment Problem:** Reacting to common cause variation by tweaking the process increases variation — this is tampering. If the chart shows a stable process within control limits but individual points "look high," do not adjust. Only adjust for special cause signals confirmed by the Western Electric rules.
- **Common vs. Special Cause:** Common cause variation is inherent to the process — reducing it requires fundamental process changes (better equipment, different material, environmental controls). Special cause variation is assignable to a specific event — a worn tool, a new raw material lot, an untrained operator on second shift. SPC's primary function is detecting special causes quickly.

### Incoming Inspection

- **AQL Sampling Plans (ANSI/ASQ Z1.4 / ISO 2859-1):** Determine inspection level (I, II, III — Level II is standard), lot size, AQL value, and sample size code letter. Tightened inspection: switch after 2 of 5 consecutive lots rejected. Normal: default. Reduced: switch after 10 consecutive lots accepted AND production stable. Critical defects: AQL = 0 with appropriate sample size. Major defects: typically AQL 1.0-2.5. Minor defects: typically AQL 2.5-6.5.
- **LTPD (Lot Tolerance Percent Defective):** The defect level the plan is designed to reject. AQL protects the producer (low risk of rejecting good lots). LTPD protects the consumer (low risk of accepting bad lots). Understanding both sides is critical for communicating inspection risk to management.
- **Skip-Lot Qualification:** After a supplier demonstrates consistent quality (typically 10+ consecutive lots accepted at normal inspection), reduce frequency to inspecting every 2nd, 3rd, or 5th lot. Revert immediately upon any rejection. Requires formal qualification criteria and documented decision.
- **Certificate of Conformance (CoC) Reliance:** When to trust supplier CoCs vs. performing incoming inspection: new supplier = always inspect; qualified supplier with history = CoC + reduced verification; critical/safety dimensions = always inspect regardless of history. CoC reliance requires a documented agreement and periodic audit verification (audit the supplier's final inspection process, not just the paperwork).

### Supplier Quality Management

- **Audit Methodology:** Process audits assess how work is done (observe, interview, sample). System audits assess QMS compliance (document review, record sampling). Product audits verify specific product characteristics. Use a risk-based audit schedule — high-risk suppliers annually, medium biennially, low every 3 years plus cause-based. Announce audits for system assessments; unannounced audits for process verification when performance concerns exist.
- **Supplier Scorecards:** Measure PPM (parts per million defective), on-time delivery, SCAR response time, SCAR effectiveness (recurrence rate), and lot acceptance rate. Weight the metrics by business impact. Share scorecards quarterly. Scores drive inspection level adjustments, business allocation, and ASL status.
- **Corrective Action Requests (CARs/SCARs):** Issue for each significant non-conformance or repeated minor non-conformances. Expect 8D or equivalent root cause analysis. Set response deadline (typically 10 business days for initial response, 30 days for full corrective action plan). Follow up on effectiveness verification.
- **Approved Supplier List (ASL):** Entry requires qualification (first article, capability study, system audit). Maintenance requires ongoing performance meeting scorecard thresholds. Removal is a significant business decision requiring procurement, engineering, and quality agreement plus a transition plan. Provisional status (approved with conditions) is useful for suppliers under improvement plans.
- **Develop vs. Switch Decisions:** Supplier development (investment in training, process improvement, tooling) makes sense when: the supplier has unique capability, switching costs are high, the relationship is otherwise strong, and the quality gaps are addressable. Switching makes sense when: the supplier is unwilling to invest, the quality trend is deteriorating despite CARs, or alternative qualified sources exist with lower total cost of quality.

### Regulatory Frameworks

- **FDA 21 CFR 820 (QSR):** Covers medical device quality systems. Key sections: 820.90 (nonconforming product), 820.100 (CAPA), 820.198 (complaint handling), 820.250 (statistical techniques). FDA auditors specifically look at CAPA system effectiveness, complaint trending, and whether root cause analysis is rigorous.
- **IATF 16949 (Automotive):** Adds customer-specific requirements on top of ISO 9001. Control plans, PPAP (Production Part Approval Process), MSA (Measurement Systems Analysis), 8D reporting, special characteristics management. Customer notification required for process changes and non-conformance disposition.
- **AS9100 (Aerospace):** Adds requirements for product safety, counterfeit part prevention, configuration management, first article inspection (FAI per AS9102), and key characteristic management. Customer approval required for use-as-is dispositions. OASIS database for supplier management.
- **ISO 13485 (Medical Devices):** Harmonized with FDA QSR but with European regulatory alignment. Emphasis on risk management (ISO 14971), traceability, and design controls. Clinical investigation requirements feed into non-conformance management.
- **Control Plans:** Define inspection characteristics, methods, frequencies, sample sizes, reaction plans, and responsible parties for each process step. Required by IATF 16949 and good practice universally. Must be a living document updated when processes change.

### Cost of Quality

Build the business case for quality investment using Juran's COQ model:

- **Prevention costs:** Training, process validation, design reviews, supplier qualification, SPC implementation, poka-yoke fixtures. Typically 5-10% of total COQ. Every dollar invested here returns $10-$100 in failure cost avoidance.
- **Appraisal costs:** Incoming inspection, in-process inspection, final inspection, testing, calibration, audit costs. Typically 20-25% of total COQ.
- **Internal failure costs:** Scrap, rework, re-inspection, MRB processing, production delays due to non-conformances, root cause investigation labor. Typically 25-40% of total COQ.
- **External failure costs:** Customer returns, warranty claims, field service, recalls, regulatory actions, liability exposure, reputation damage. Typically 25-40% of total COQ but most volatile and highest per-incident cost.

## Decision Frameworks

### NCR Disposition Decision Logic

Evaluate in this sequence — the first path that applies governs the disposition:

1. **Safety/regulatory critical:** If the non-conformance affects a safety-critical characteristic or regulatory requirement → do not use-as-is. Rework if possible to full conformance, otherwise scrap. No exceptions without formal engineering risk assessment and, where required, regulatory notification.
2. **Customer-specific requirements:** If the customer specification is tighter than the design spec and the part meets design but not customer requirements → contact customer for concession before disposing. Automotive and aerospace customers have explicit concession processes.
3. **Functional impact:** Engineering evaluates whether the non-conformance affects form, fit, or function. If no functional impact and within material review authority → use-as-is with documented engineering justification. If functional impact exists → rework or scrap.
4. **Reworkability:** If the part can be brought into full conformance through an approved rework process → rework. Verify rework cost vs. replacement cost. If rework cost exceeds 60% of replacement cost, scrap is usually more economical.
5. **Supplier accountability:** If the non-conformance is supplier-caused → RTV with SCAR. Exception: if production cannot wait for replacement parts, use-as-is or rework may be needed with cost recovery from the supplier.

### RCA Method Selection

- **Single-event, simple causal chain:** 5 Whys. Budget: 1-2 hours.
- **Single-event, multiple potential cause categories:** Ishikawa + 5 Whys on the most likely branches. Budget: 4-8 hours.
- **Recurring issue, process-related:** 8D with full team. Budget: 20-40 hours across D0-D8.
- **Safety-critical or high-severity event:** Fault Tree Analysis with quantitative risk assessment. Budget: 40-80 hours. Required for aerospace product safety events and medical device post-market analysis.
- **Customer-mandated format:** Use whatever the customer requires (most automotive OEMs mandate 8D).

### CAPA Effectiveness Verification

Before closing any CAPA, verify:

1. **Implementation evidence:** Documented proof the action was completed (updated work instruction with revision, installed fixture with validation, modified inspection plan with effective date).
2. **Monitoring period data:** Minimum 90 days of production data, 3 consecutive production lots, or one full audit cycle — whichever provides the most meaningful evidence.
3. **Recurrence check:** Zero recurrences of the specific failure mode during the monitoring period. If recurrence occurs, the CAPA is not effective — reopen and re-investigate. Do not close and open a new CAPA for the same issue.
4. **Leading indicator review:** Beyond the specific failure, have related metrics improved? (e.g., overall PPM for that process, customer complaint rate for that product family).

### Inspection Level Adjustment

| Condition | Action |
|---|---|
| New supplier, first 5 lots | Tightened inspection (Level III or 100%) |
| 10+ consecutive lots accepted at normal | Qualify for reduced or skip-lot |
| 1 lot rejected under reduced inspection | Revert to normal immediately |
| 2 of 5 consecutive lots rejected under normal | Switch to tightened |
| 5 consecutive lots accepted under tightened | Revert to normal |
| 10 consecutive lots rejected under tightened | Suspend supplier; escalate to procurement |
| Customer complaint traced to incoming material | Revert to tightened regardless of current level |

### Supplier Corrective Action Escalation

| Stage | Trigger | Action | Timeline |
|---|---|---|---|
| Level 1: SCAR issued | Single significant NC or 3+ minor NCs in 90 days | Formal SCAR requiring 8D response | 10 days for response, 30 for implementation |
| Level 2: Supplier on watch | SCAR not responded to in time, or corrective action not effective | Increased inspection, supplier on probation, procurement notified | 60 days to demonstrate improvement |
| Level 3: Controlled shipping | Continued quality failures during watch period | Supplier must submit inspection data with each shipment; or third-party sort at supplier's expense | 90 days to demonstrate sustained improvement |
| Level 4: New source qualification | No improvement under controlled shipping | Initiate alternate supplier qualification; reduce business allocation | Qualification timeline (3-12 months depending on industry) |
| Level 5: ASL removal | Failure to improve or unwillingness to invest | Formal removal from Approved Supplier List; transition all parts | Complete transition before final PO |

## Key Edge Cases

These are situations where the obvious approach is wrong. Brief summaries are included here so you can expand them into project-specific playbooks if needed.

1. **Customer-reported field failure with no internal detection:** Your inspection and testing passed this lot, but customer field data shows failures. The instinct is to question the customer's data — resist it. Check whether your inspection plan covers the actual failure mode. Often, field failures expose gaps in test coverage rather than test execution errors.

2. **Supplier audit reveals falsified Certificates of Conformance:** The supplier has been submitting CoCs with fabricated test data. Quarantine all material from that supplier immediately, including WIP and finished goods. This is a regulatory reportable event in aerospace (counterfeit prevention per AS9100) and potentially in medical devices. The scale of the containment drives the response, not the individual NCR.

3. **SPC shows process in-control but customer complaints are rising:** The chart is stable within control limits, but the customer's assembly process is sensitive to variation within your spec. Your process is "capable" by the numbers but not capable enough. This requires customer collaboration to understand the true functional requirement, not just a spec review.

4. **Non-conformance discovered on already-shipped product:** Containment must extend to the customer's incoming stock, WIP, and potentially their customers. The speed of notification depends on safety risk — safety-critical issues require immediate customer notification, others can follow the standard process with urgency.

5. **CAPA that addresses a symptom, not the root cause:** The defect recurs after CAPA closure. Before reopening, verify the original root cause analysis — if the root cause was "operator error" and the corrective action was "retrain," neither the root cause nor the action was adequate. Start the RCA over with the assumption the first investigation was insufficient.

6. **Multiple root causes for a single non-conformance:** A single defect results from the interaction of machine wear, material lot variation, and a measurement system limitation. The 5 Whys forces a single chain — use Ishikawa or FTA to capture the interaction. Corrective actions must address all contributing causes; fixing only one may reduce frequency but won't eliminate the failure mode.

7. **Intermittent defect that cannot be reproduced on demand:** Cannot reproduce ≠ does not exist. Increase sample size and monitoring frequency. Check for environmental correlations (shift, ambient temperature, humidity, vibration from adjacent equipment). Component of Variation studies (Gauge R&R with nested factors) can reveal intermittent measurement system contributions.

8. **Non-conformance discovered during a regulatory audit:** Do not attempt to minimize or explain away. Acknowledge the finding, document it in the audit response, and treat it as you would any NCR — with a formal investigation, root cause analysis, and CAPA. Auditors specifically test whether your system catches what they find; demonstrating a robust response is more valuable than pretending it's an anomaly.

## Communication Patterns

### Tone Calibration

Match communication tone to situation severity and audience:

- **Routine NCR, internal team:** Direct and factual. "NCR-2025-0412: Incoming lot 4471 of part 7832-A has OD measurements at 12.52mm against a 12.45±0.05mm specification. 18 of 50 sample pieces out of spec. Material quarantined in MRB cage, Bay 3."
- **Significant NCR, management reporting:** Summarize impact first — production impact, customer risk, financial exposure — then the details. Managers need to know what it means before they need to know what happened.
- **Supplier notification (SCAR):** Professional, specific, and documented. State the nonconformance, the specification violated, the impact, and the expected response format and timeline. Never accusatory; the data speaks.
- **Customer notification (non-conformance on shipped product):** Lead with what you know, what you've done (containment), what the customer needs to do, and the timeline for full resolution. Transparency builds trust; delay destroys it.
- **Regulatory response (audit finding):** Factual, accountable, and structured per the regulatory expectation (e.g., FDA Form 483 response format). Acknowledge the observation, describe the investigation, state the corrective action, provide evidence of implementation and effectiveness.

### Key Templates

Brief templates appear below. Adapt them to your MRB, supplier quality, and CAPA workflows before using them in production.

**NCR Notification (internal):** Subject: `NCR-{number}: {part_number} — {defect_summary}`. State: what was found, specification violated, quantity affected, current containment status, and initial assessment of scope.

**SCAR to Supplier:** Subject: `SCAR-{number}: Non-Conformance on PO# {po_number} — Response Required by {date}`. Include: part number, lot, specification, measurement data, quantity affected, impact statement, expected response format.

**Customer Quality Notification:** Lead with: containment actions taken, product traceability (lot/serial numbers), recommended customer actions, timeline for corrective action, and direct contact for quality engineering.

## Escalation Protocols

### Automatic Escalation Triggers

| Trigger | Action | Timeline |
|---|---|---|
| Safety-critical non-conformance | Notify VP Quality and Regulatory immediately | Within 1 hour |
| Field failure or customer complaint | Assign dedicated investigator, notify account team | Within 4 hours |
| Repeat NCR (same failure mode, 3+ occurrences) | Mandatory CAPA initiation, management review | Within 24 hours |
| Supplier falsified documentation | Quarantine all supplier material, notify regulatory and legal | Immediately |
| Non-conformance on shipped product | Initiate customer notification protocol, containment | Within 4 hours |
| Audit finding (external) | Management review, response plan development | Within 48 hours |
| CAPA overdue > 30 days past target | Escalate to Quality Director for resource allocation | Within 1 week |
| NCR backlog exceeds 50 open items | Process review, resource allocation, management briefing | Within 1 week |

### Escalation Chain

Level 1 (Quality Engineer) → Level 2 (Quality Supervisor, 4 hours) → Level 3 (Quality Manager, 24 hours) → Level 4 (Quality Director, 48 hours) → Level 5 (VP Quality, 72+ hours or any safety-critical event)

## Performance Indicators

Track these metrics weekly and trend monthly:

| Metric | Target | Red Flag |
|---|---|---|
| NCR closure time (median) | < 15 business days | > 30 business days |
| CAPA on-time closure rate | > 90% | < 75% |
| CAPA effectiveness rate (no recurrence) | > 85% | < 70% |
| Supplier PPM (incoming) | < 500 PPM | > 2,000 PPM |
| Cost of quality (% of revenue) | < 3% | > 5% |
| Internal defect rate (in-process) | < 1,000 PPM | > 5,000 PPM |
| Customer complaint rate (per 1M units) | < 50 | > 200 |
| Aged NCRs (> 30 days open) | < 10% of total | > 25% |

## Additional Resources

- Pair this skill with your NCR template, disposition authority matrix, and SPC rule set so investigators use the same definitions every time.
- Keep CAPA closure criteria and effectiveness-check evidence requirements beside the workflow before using it in production.
