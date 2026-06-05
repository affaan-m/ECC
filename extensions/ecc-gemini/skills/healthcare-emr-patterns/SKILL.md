---
name: healthcare-emr-patterns
description: EMR/EHR development patterns for healthcare applications. Clinical safety, encounter workflows, prescription generation, clinical decision support integration, and accessibility-first UI for medical data entry.
origin: Health1 Super Speciality Hospitals — contributed by Dr. Keyur Patel
version: "1.0.0"
---

# Healthcare EMR Development Patterns

Patterns for building Electronic Medical Record (EMR) and Electronic Health Record (EHR) systems. Prioritizes patient safety, clinical accuracy, and practitioner efficiency.

## When to Use

- Building patient encounter workflows (complaint, exam, diagnosis, prescription)
- Implementing clinical note-taking (structured + free text + voice-to-text)
- Designing prescription/medication modules with drug interaction checking
- Integrating Clinical Decision Support Systems (CDSS)
- Building lab result displays with reference range highlighting
- Implementing audit trails for clinical data
- Designing healthcare-accessible UIs for clinical data entry

## How It Works

### Patient Safety First

Every design decision must be evaluated against: "Could this harm a patient?"

- Drug interactions MUST alert, not silently pass
- Abnormal lab values MUST be visually flagged
- Critical vitals MUST trigger escalation workflows
- No clinical data modification without audit trail

### Single-Page Encounter Flow

Clinical encounters should flow vertically on a single page — no tab switching:

```
Patient Header (sticky — always visible)
├── Demographics, allergies, active medications
│
Encounter Flow (vertical scroll)
├── 1. Chief Complaint (structured templates + free text)
├── 2. History of Present Illness
├── 3. Physical Examination (system-wise)
├── 4. Vitals (auto-trigger clinical scoring)
├── 5. Diagnosis (ICD-10/SNOMED search)
├── 6. Medications (drug DB + interaction check)
├── 7. Investigations (lab/radiology orders)
├── 8. Plan & Follow-up
└── 9. Sign / Lock / Print
```

### Smart Template System

```typescript
interface ClinicalTemplate {
  id: string;
  name: string;             // e.g., "Chest Pain"
  chips: string[];          // clickable symptom chips
  requiredFields: string[]; // mandatory data points
  redFlags: string[];       // triggers non-dismissable alert
  icdSuggestions: string[]; // pre-mapped diagnosis codes
}
```

Red flags in any template must trigger a visible, non-dismissable alert — NOT a toast notification.

### Medication Safety Pattern

```
User selects drug
  → Check current medications for interactions
  → Check encounter medications for interactions
  → Check patient allergies
  → Validate dose against weight/age/renal function
  → If CRITICAL interaction: BLOCK prescribing entirely
  → Clinician must document override reason to proceed past a block
  → If MAJOR interaction: display warning, require acknowledgment
  → Log all alerts and override reasons in audit trail
```

Critical interactions **block prescribing by default**. The clinician must explicitly override with a documented reason stored in the audit trail. The system never silently allows a critical interaction.

### Locked Encounter Pattern

Once a clinical encounter is signed:
- No edits allowed — only an addendum (a separate linked record)
- Both original and addendum appear in the patient timeline
- Audit trail captures who signed, when, and any addendum records

### UI Patterns for Clinical Data

**Vitals Display:** Current values with normal range highlighting (green/yellow/red), trend arrows vs previous, clinical scoring auto-calculated (NEWS2, qSOFA), escalation guidance inline.

**Lab Results Display:** Normal range highlighting, previous value comparison, critical values with non-dismissable alert, collection/analysis timestamps, pending orders with expected turnaround.

**Prescription PDF:** One-click generation with patient demographics, allergies, diagnosis, drug details (generic + brand, dose, route, frequency, duration), clinician signature block.

### Accessibility for Healthcare

Healthcare UIs have stricter requirements than typical web apps:
- 4.5:1 minimum contrast (WCAG AA) — clinicians work in varied lighting
- Large touch targets (44x44px minimum) — for gloved/rushed interaction
- Keyboard navigation — for power users entering data rapidly
- No color-only indicators — always pair color with text/icon (colorblind clinicians)
- Screen reader labels on all form fields
- No auto-dismissing toasts for clinical alerts — clinician must actively acknowledge

### Anti-Patterns

- Storing clinical data in browser localStorage
- Silent failures in drug interaction checking
- Dismissable toasts for critical clinical alerts
- Tab-based encounter UIs that fragment the clinical workflow
- Allowing edits to signed/locked encounters
- Displaying clinical data without audit trail
- Using `any` type for clinical data structures

## Examples

### Example 1: Patient Encounter Flow

```
Doctor opens encounter for Patient #4521
  → Sticky header shows: "Rajesh M, 58M, Allergies: Penicillin, Active Meds: Metformin 500mg"
  → Chief Complaint: selects "Chest Pain" template
    → Clicks chips: "substernal", "radiating to left arm", "crushing"
    → Red flag "crushing substernal chest pain" triggers non-dismissable alert
  → Examination: CVS system — "S1 S2 normal, no murmur"
  → Vitals: HR 110, BP 90/60, SpO2 94%
    → NEWS2 auto-calculates: score 8, risk HIGH, escalation alert shown
  → Diagnosis: searches "ACS" → selects ICD-10 I21.9
  → Medications: selects Aspirin 300mg
    → CDSS checks against Metformin: no interaction
  → Signs encounter → locked, addendum-only from this point
```

### Example 2: Medication Safety Workflow

```
Doctor prescribes Warfarin for Patient #4521
  → CDSS detects: Warfarin + Aspirin = CRITICAL interaction
  → UI: red non-dismissable modal blocks prescribing
  → Doctor clicks "Override with reason"
  → Types: "Benefits outweigh risks — monitored INR protocol"
  → Override reason + alert stored in audit trail
  → Prescription proceeds with documented override
```

### Example 3: Locked Encounter + Addendum

```
Encounter #E-2024-0891 signed by Dr. Shah at 14:30
  → All fields locked — no edit buttons visible
  → "Add Addendum" button available
  → Dr. Shah clicks addendum, adds: "Lab results received — Troponin elevated"
  → New record E-2024-0891-A1 linked to original
  → Timeline shows both: original encounter + addendum with timestamps
```
