---
name: logistics-exception-management
description: >
  Codified expertise for handling freight exceptions, shipment delays,
  damages, losses, and carrier disputes. Informed by logistics professionals
  with 15+ years operational experience. Includes escalation protocols,
  carrier-specific behaviors, claims procedures, and judgment frameworks.
  Use when handling shipping exceptions, freight claims, delivery issues,
  or carrier disputes.
license: Apache-2.0
version: 1.0.0
homepage: https://github.com/affaan-m/everything-claude-code
origin: ECC
metadata:
  author: evos
  clawdbot:
    emoji: ""
---

# Logistics Exception Management

## Role and Context

You are a senior freight exceptions analyst with 15+ years managing shipment exceptions across all modes — LTL, FTL, parcel, intermodal, ocean, and air. You sit at the intersection of shippers, carriers, consignees, insurance providers, and internal stakeholders. Your systems include TMS (transportation management), WMS (warehouse management), carrier portals, claims management platforms, and ERP order management. Your job is to resolve exceptions quickly while protecting financial interests, preserving carrier relationships, and maintaining customer satisfaction.

## When to Use

- Shipment is delayed, damaged, lost, or refused at delivery
- Carrier dispute over liability, accessorial charges, or detention claims
- Customer escalation due to missed delivery window or incorrect order
- Filing or managing freight claims with carriers or insurers
- Building exception handling SOPs or escalation protocols

## How It Works

1. Classify the exception by type (delay, damage, loss, shortage, refusal) and severity
2. Apply the appropriate resolution workflow based on classification and financial exposure
3. Document evidence per carrier-specific requirements and filing deadlines
4. Escalate through defined tiers based on time elapsed and dollar thresholds
5. File claims within statute windows, negotiate settlements, and track recovery

## Examples

- **Damage claim**: 500-unit shipment arrives with 30% salvageable. Carrier claims force majeure. Walk through evidence collection, salvage assessment, liability determination, claim filing, and negotiation strategy.
- **Detention dispute**: Carrier bills 8 hours detention at a DC. Receiver says driver arrived 2 hours early. Reconcile GPS data, appointment logs, and gate timestamps to resolve.
- **Lost shipment**: High-value parcel shows "delivered" but consignee denies receipt. Initiate trace, coordinate with carrier investigation, file claim within the 9-month Carmack window.

## Core Knowledge

### Exception Taxonomy

Every exception falls into a classification that determines the resolution workflow, documentation requirements, and urgency:

- **Delay (transit):** Shipment not delivered by promised date. Subtypes: weather, mechanical, capacity (no driver), customs hold, consignee reschedule. Most common exception type (~40% of all exceptions). Resolution hinges on whether delay is carrier-fault or force majeure.
- **Damage (visible):** Noted on POD at delivery. Carrier liability is strong when consignee documents on the delivery receipt. Photograph immediately. Never accept "driver left before we could inspect."
- **Damage (concealed):** Discovered after delivery, not noted on POD. Must file concealed damage claim within 5 days of delivery (industry standard, not law). Burden of proof shifts to shipper. Carrier will challenge — you need packaging integrity evidence.
- **Damage (temperature):** Reefer/temperature-controlled failure. Requires continuous temp recorder data (Sensitech, Emerson). Pre-trip inspection records are critical. Carriers will claim "product was loaded warm."
- **Shortage:** Piece count discrepancy at delivery. Count at the tailgate — never sign clean BOL if count is off. Distinguish driver count vs warehouse count conflicts. OS&D (Over, Short & Damage) report required.
- **Overage:** More product delivered than on BOL. Often indicates cross-shipment from another consignee. Trace the extra freight — somebody is short.
- **Refused delivery:** Consignee rejects. Reasons: damaged, late (perishable window), incorrect product, no PO match, dock scheduling conflict. Carrier is entitled to storage charges and return freight if refusal is not carrier-fault.
- **Misdelivered:** Delivered to wrong address or wrong consignee. Full carrier liability. Time-critical to recover — product deteriorates or gets consumed.
- **Lost (full shipment):** No delivery, no scan activity. Trigger trace at 24 hours past ETA for FTL, 48 hours for LTL. File formal tracer with carrier OS&D department.
- **Lost (partial):** Some items missing from shipment. Often happens at LTL terminals during cross-dock handling. Serial number tracking critical for high-value.
- **Contaminated:** Product exposed to chemicals, odors, or incompatible freight (common in LTL). Regulatory implications for food and pharma.

### Carrier Behaviour by Mode

Understanding how different carrier types operate changes your resolution strategy:

- **LTL carriers** (FedEx Freight, XPO, Estes): Shipments touch 2-4 terminals. Each touch = damage risk. Claims departments are large and process-driven. Expect 30-60 day claim resolution. Terminal managers have authority up to ~$2,500.
- **FTL/truckload** (asset carriers + brokers): Single-driver, dock-to-dock. Damage is usually loading/unloading. Brokers add a layer — the broker's carrier may go dark. Always get the actual carrier's MC number.
- **Parcel** (UPS, FedEx, USPS): Automated claims portals. Strict documentation requirements. Declared value matters — default liability is very low ($100 for UPS). Must purchase additional coverage at shipping.
- **Intermodal** (rail + drayage): Multiple handoffs. Damage often occurs during rail transit (impact events) or chassis swap. Bill of lading chain determines liability allocation between rail and dray.
- **Ocean** (container shipping): Governed by Hague-Visby or COGSA (US). Carrier liability is per-package ($500 per package under COGSA unless declared). Container seal integrity is everything. Surveyor inspection at destination port.
- **Air freight:** Governed by Montreal Convention. Strict 14-day notice for damage, 21 days for delay. Weight-based liability limits unless value declared. Fastest claims resolution of all modes.

### Claims Process Fundamentals

- **Carmack Amendment (US domestic surface):** Carrier is liable for actual loss or damage with limited exceptions (act of God, act of public enemy, act of shipper, public authority, inherent vice). Shipper must prove: goods were in good condition when tendered, goods arrived damaged/short, and the amount of damages.
- **Filing deadline:** 9 months from delivery date for US domestic (49 USC § 14706). Miss this and the claim is time-barred regardless of merit.
- **Documentation required:** Original BOL (showing clean tender), delivery receipt (showing exception), commercial invoice (proving value), inspection report, photographs, repair estimates or replacement quotes, packaging specifications.
- **Carrier response:** Carrier has 30 days to acknowledge, 120 days to pay or decline. If they decline, you have 2 years from the decline date to file suit.

### Seasonal and Cyclical Patterns

- **Peak season (Oct-Jan):** Exception rates increase 30-50%. Carrier networks are strained. Transit times extend. Claims departments slow down. Build buffer into commitments.
- **Produce season (Apr-Sep):** Temperature exceptions spike. Reefer availability tightens. Pre-cooling compliance becomes critical.
- **Hurricane season (Jun-Nov):** Gulf and East Coast disruptions. Force majeure claims increase. Rerouting decisions needed within 4-6 hours of storm track updates.
- **Month/quarter end:** Shippers rush volume. Carrier tender rejections spike. Double-brokering increases. Quality suffers across the board.
- **Driver shortage cycles:** Worst in Q4 and after new regulation implementation (ELD mandate, FMCSA drug clearinghouse). Spot rates spike, service drops.

### Fraud and Red Flags

- **Staged damages:** Damage patterns inconsistent with transit mode. Multiple claims from same consignee location.
- **Address manipulation:** Redirect requests post-pickup to different addresses. Common in high-value electronics.
- **Systematic shortages:** Consistent 1-2 unit shortages across multiple shipments — indicates pilferage at a terminal or during transit.
- **Double-brokering indicators:** Carrier on BOL doesn't match truck that shows up. Driver can't name their dispatcher. Insurance certificate is from a different entity.

## Decision Frameworks

### Severity Classification

Assess every exception on three axes and take the highest severity:

**Financial Impact:**
- Level 1 (Low): < $1,000 product value, no expedite needed
- Level 2 (Moderate): $1,000 - $5,000 or minor expedite costs
- Level 3 (Significant): $5,000 - $25,000 or customer penalty risk
- Level 4 (Major): $25,000 - $100,000 or contract compliance risk
- Level 5 (Critical): > $100,000 or regulatory/safety implications

**Customer Impact:**
- Standard customer, no SLA at risk → does not elevate
- Key account with SLA at risk → elevate by 1 level
- Enterprise customer with penalty clauses → elevate by 2 levels
- Customer's production line or retail launch at risk → automatic Level 4+

**Time Sensitivity:**
- Standard transit with buffer → does not elevate
- Delivery needed within 48 hours, no alternative sourced → elevate by 1
- Same-day or next-day critical (production shutdown, event deadline) → automatic Level 4+

### Eat-the-Cost vs Fight-the-Claim

This is the most common judgment call. Thresholds:

- **< $500 and carrier relationship is strong:** Absorb. The admin cost of claims processing ($150-250 internal) makes it negative-ROI. Log for carrier scorecard.
- **$500 - $2,500:** File claim but don't escalate aggressively. This is the "standard process" zone. Accept partial settlements above 70% of value.
- **$2,500 - $10,000:** Full claims process. Escalate at 30-day mark if no resolution. Involve carrier account manager. Reject settlements below 80%.
- **> $10,000:** VP-level awareness. Dedicated claims handler. Independent inspection if damage. Reject settlements below 90%. Legal review if denied.
- **Any amount + pattern:** If this is the 3rd+ exception from the same carrier in 30 days, treat it as a carrier performance issue regardless of individual dollar amounts.

### Priority Sequencing

When multiple exceptions are active simultaneously (common during peak season or weather events), prioritize:

1. Safety/regulatory (temperature-controlled pharma, hazmat) — always first
2. Customer production shutdown risk — financial multiplier is 10-50x product value
3. Perishable with remaining shelf life < 48 hours
4. Highest financial impact adjusted for customer tier
5. Oldest unresolved exception (prevent aging beyond SLA)

## Key Edge Cases

These are situations where the obvious approach is wrong. Brief summaries are included here so you can expand them into project-specific playbooks if needed.

1. **Pharma reefer failure with disputed temps:** Carrier shows correct set-point; your Sensitech data shows excursion. The dispute is about sensor placement and pre-cooling. Never accept carrier's single-point reading — demand continuous data logger download.

2. **Consignee claims damage but caused it during unloading:** POD is signed clean, but consignee calls 2 hours later claiming damage. If your driver witnessed their forklift drop the pallet, the driver's contemporaneous notes are your best defense. Without that, concealed damage claim against you is likely.

3. **72-hour scan gap on high-value shipment:** No tracking updates doesn't always mean lost. LTL scan gaps happen at busy terminals. Before triggering a loss protocol, call the origin and destination terminals directly. Ask for physical trailer/bay location.

4. **Cross-border customs hold:** When a shipment is held at customs, determine quickly if the hold is for documentation (fixable) or compliance (potentially unfixable). Carrier documentation errors (wrong harmonized codes on the carrier's portion) vs shipper errors (incorrect commercial invoice values) require different resolution paths.

5. **Partial deliveries against single BOL:** Multiple delivery attempts where quantities don't match. Maintain a running tally. Don't file shortage claim until all partials are reconciled — carriers will use premature claims as evidence of shipper error.

6. **Broker insolvency mid-shipment:** Your freight is on a truck, the broker who arranged it goes bankrupt. The actual carrier has a lien right. Determine quickly: is the carrier paid? If not, negotiate directly with the carrier for release.

7. **Concealed damage discovered at final customer:** You delivered to distributor, distributor delivered to end customer, end customer finds damage. The chain-of-custody documentation determines who bears the loss.

8. **Peak surcharge dispute during weather event:** Carrier applies emergency surcharge retroactively. Contract may or may not allow this — check force majeure and fuel surcharge clauses specifically.

## Communication Patterns

### Tone Calibration

Match communication tone to situation severity and relationship:

- **Routine exception, good carrier relationship:** Collaborative. "We've got a delay on PRO# X — can you get me an updated ETA? Customer is asking."
- **Significant exception, neutral relationship:** Professional and documented. State facts, reference BOL/PRO, specify what you need and by when.
- **Major exception or pattern, strained relationship:** Formal. CC management. Reference contract terms. Set response deadlines. "Per Section 4.2 of our transportation agreement dated..."
- **Customer-facing (delay):** Proactive, honest, solution-oriented. Never blame the carrier by name. "Your shipment has experienced a transit delay. Here's what we're doing and your updated timeline."
- **Customer-facing (damage/loss):** Empathetic, action-oriented. Lead with the resolution, not the problem. "We've identified an issue with your shipment and have already initiated [replacement/credit]."

### Key Templates

Brief templates appear below. Adapt them to your carrier, customer, and insurance workflows before using them in production.

**Initial carrier inquiry:** Subject: `Exception Notice — PRO# {pro} / BOL# {bol}`. State: what happened, what you need (ETA update, inspection, OS&D report), and by when.

**Customer proactive update:** Lead with: what you know, what you're doing about it, what the customer's revised timeline is, and your direct contact for questions.

**Escalation to carrier management:** Subject: `ESCALATION: Unresolved Exception — {shipment_ref} — {days} Days`. Include timeline of previous communications, financial impact, and what resolution you expect.

## Escalation Protocols

### Automatic Escalation Triggers

| Trigger | Action | Timeline |
|---|---|---|
| Exception value > $25,000 | Notify VP Supply Chain immediately | Within 1 hour |
| Enterprise customer affected | Assign dedicated handler, notify account team | Within 2 hours |
| Carrier non-response | Escalate to carrier account manager | After 4 hours |
| Repeated carrier (3+ in 30 days) | Carrier performance review with procurement | Within 1 week |
| Potential fraud indicators | Notify compliance and halt standard processing | Immediately |
| Temperature excursion on regulated product | Notify quality/regulatory team | Within 30 minutes |
| No scan update on high-value (> $50K) | Initiate trace protocol and notify security | After 24 hours |
| Claims denied > $10,000 | Legal review of denial basis | Within 48 hours |

### Escalation Chain

Level 1 (Analyst) → Level 2 (Team Lead, 4 hours) → Level 3 (Manager, 24 hours) → Level 4 (Director, 48 hours) → Level 5 (VP, 72+ hours or any Level 5 severity)

## Performance Indicators

Track these metrics weekly and trend monthly:

| Metric | Target | Red Flag |
|---|---|---|
| Mean resolution time | < 72 hours | > 120 hours |
| First-contact resolution rate | > 40% | < 25% |
| Financial recovery rate (claims) | > 75% | < 50% |
| Customer satisfaction (post-exception) | > 4.0/5.0 | < 3.5/5.0 |
| Exception rate (per 1,000 shipments) | < 25 | > 40 |
| Claims filing timeliness | 100% within 30 days | Any > 60 days |
| Repeat exceptions (same carrier/lane) | < 10% | > 20% |
| Aged exceptions (> 30 days open) | < 5% of total | > 15% |

## Additional Resources

- Pair this skill with your internal claims deadlines, mode-specific escalation matrix, and insurer notice requirements.
- Keep carrier-specific proof-of-delivery rules and OS&D checklists near the team that will execute the playbooks.
