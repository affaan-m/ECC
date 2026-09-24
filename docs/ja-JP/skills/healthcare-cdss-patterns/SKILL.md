---
name: healthcare-cdss-patterns
description: 臨床意思決定支援システム（CDSS）パターン、医学的推論、およびエビデンスベースの実装。
origin: Health1 Super Speciality Hospitals — contributed by Dr. Keyur Patel
version: "1.0.0"
---

# Healthcare CDSS Development Patterns

Patterns for building Clinical Decision Support Systems that integrate into EMR workflows. CDSS modules are patient safety critical — zero tolerance for false negatives.

## When to Use

- Implementing drug interaction checking
- Building dose validation engines
- Implementing clinical scoring systems (NEWS2, qSOFA, APACHE, GCS)
- Designing alert systems for abnormal clinical values
- Building medication order entry with safety checks
- Integrating lab result interpretation with clinical context

## How It Works

The CDSS engine is a **pure function library with zero side effects**. Input clinical data, output alerts. This makes it fully testable.

Three primary modules:

1. **`checkInteractions(newDrug, currentMeds, allergies)`** — Checks a new drug against current medications and known allergies. Returns severity-sorted `InteractionAlert[]`. Uses `DrugInteractionPair` data model.
2. **`validateDose(drug, dose, route, weight, age, renalFunction)`** — Validates a prescribed dose against weight-based, age-adjusted, and renal-adjusted rules. Returns `DoseValidationResult`.
3. **`calculateNEWS2(vitals)`** — National Early Warning Score 2 from `NEWS2Input`. Returns `NEWS2Result` with total score, risk level, and escalation guidance.

```
EMR UI
  ↓ (user enters data)
CDSS Engine (pure functions, no side effects)
  ├── Drug Interaction Checker
  ├── Dose Validator
  ├── Clinical Scoring (NEWS2, qSOFA, etc.)
  └── Alert Classifier
  ↓ (returns alerts)
EMR UI (displays alerts inline, blocks if critical)
```

### Drug Interaction Checking

```typescript
interface DrugInteractionPair {
  drugA: string;           // generic name
  drugB: string;           // generic name
  severity: 'critical' | 'major' | 'minor';
  mechanism: string;
  clinicalEffect: string;
  recommendation: string;
}

function checkInteractions(
  newDrug: string,
  currentMedications: string[],
  allergyList: string[]
): InteractionAlert[] {
  if (!newDrug) return [];
  const alerts: InteractionAlert[] = [];
  for (const current of currentMedications) {
    const interaction = findInteraction(newDrug, current);
    if (interaction) {
      alerts.push({ severity: interaction.severity, pair: [newDrug, current],
        message: interaction.clinicalEffect, recommendation: interaction.recommendation });
    }
  }
  for (const allergy of allergyList) {
    if (isCrossReactive(newDrug, allergy)) {
      alerts.push({ severity: 'critical', pair: [newDrug, allergy],
        message: `Cross-reactivity with documented allergy: ${allergy}`,
        recommendation: 'Do not prescribe without allergy consultation' });
    }
  }
  return alerts.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
}
```

Interaction pairs must be **bidirectional**: if Drug A interacts with Drug B, then Drug B interacts with Drug A.

### Dose Validation

```typescript
interface DoseValidationResult {
  valid: boolean;
  message: string;
  suggestedRange: { min: number; max: number; unit: string } | null;
  factors: string[];
}

function validateDose(
  drug: string,
  dose: number,
  route: 'oral' | 'iv' | 'im' | 'sc' | 'topical',
  patientWeight?: number,
  patientAge?: number,
  renalFunction?: number
): DoseValidationResult {
  const rules = getDoseRules(drug, route);
  if (!rules) return { valid: true, message: 'No validation rules available', suggestedRange: null, factors: [] };
  const factors: string[] = [];

  // SAFETY: if rules require weight but weight missing, BLOCK (not pass)
  if (rules.weightBased) {
    if (!patientWeight || patientWeight <= 0) {
      return { valid: false, message: `Weight required for ${drug} (mg/kg drug)`,
        suggestedRange: null, factors: ['weight_missing'] };
    }
    factors.push('weight');
    const maxDose = rules.maxPerKg * patientWeight;
    if (dose > maxDose) {
      return { valid: false, message: `Dose exceeds max for ${patientWeight}kg`,
        suggestedRange: { min: rules.minPerKg * patientWeight, max: maxDose, unit: rules.unit }, factors };
    }
  }

  // Age-based adjustment (when rules define age brackets and age is provided)
  if (rules.ageAdjusted && patientAge !== undefined) {
    factors.push('age');
    const ageMax = rules.getAgeAdjustedMax(patientAge);
    if (dose > ageMax) {
      return { valid: false, message: `Exceeds age-adjusted max for ${patientAge}yr`,
        suggestedRange: { min: rules.typicalMin, max: ageMax, unit: rules.unit }, factors };
    }
  }

  // Renal adjustment (when rules define eGFR brackets and eGFR is provided)
  if (rules.renalAdjusted && renalFunction !== undefined) {
    factors.push('renal');
    const renalMax = rules.getRenalAdjustedMax(renalFunction);
    if (dose > renalMax) {
      return { valid: false, message: `Exceeds renal-adjusted max for eGFR ${renalFunction}`,
        suggestedRange: { min: rules.typicalMin, max: renalMax, unit: rules.unit }, factors };
    }
  }

  // Absolute max
  if (dose > rules.absoluteMax) {
    return { valid: false, message: `Exceeds absolute max ${rules.absoluteMax}${rules.unit}`,
      suggestedRange: { min: rules.typicalMin, max: rules.absoluteMax, unit: rules.unit },
      factors: [...factors, 'absolute_max'] };
  }
  return { valid: true, message: 'Within range',
    suggestedRange: { min: rules.typicalMin, max: rules.typicalMax, unit: rules.unit }, factors };
}
```

### Clinical Scoring: NEWS2

```typescript
interface NEWS2Input {
  respiratoryRate: number; oxygenSaturation: number; supplementalOxygen: boolean;
  temperature: number; systolicBP: number; heartRate: number;
  consciousness: 'alert' | 'voice' | 'pain' | 'unresponsive';
}
interface NEWS2Result {
  total: number;           // 0-20
  risk: 'low' | 'low-medium' | 'medium' | 'high';
  components: Record<string, number>;
  escalation: string;
}
```

Scoring tables must match the Royal College of Physicians specification exactly.

### Alert Severity and UI Behavior

| Severity | UI Behavior | Clinician Action Required |
|----------|-------------|--------------------------|
| Critical | Block action. Non-dismissable modal. Red. | Must document override reason to proceed |
| Major | Warning banner inline. Orange. | Must acknowledge before proceeding |
| Minor | Info note inline. Yellow. | Awareness only, no action required |

Critical alerts must NEVER be auto-dismissed or implemented as toast notifications. Override reasons must be stored in the audit trail.

### Testing CDSS (Zero Tolerance for False Negatives)

```typescript
describe('CDSS — Patient Safety', () => {
  INTERACTION_PAIRS.forEach(({ drugA, drugB, severity }) => {
    it(`detects ${drugA} + ${drugB} (${severity})`, () => {
      const alerts = checkInteractions(drugA, [drugB], []);
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].severity).toBe(severity);
    });
    it(`detects ${drugB} + ${drugA} (reverse)`, () => {
      const alerts = checkInteractions(drugB, [drugA], []);
      expect(alerts.length).toBeGreaterThan(0);
    });
  });
  it('blocks mg/kg drug when weight is missing', () => {
    const result = validateDose('gentamicin', 300, 'iv');
    expect(result.valid).toBe(false);
    expect(result.factors).toContain('weight_missing');
  });
  it('handles malformed drug data gracefully', () => {
    expect(() => checkInteractions('', [], [])).not.toThrow();
  });
});
```

Pass criteria: 100%. A single missed interaction is a patient safety event.

### Anti-Patterns

- Making CDSS checks optional or skippable without documented reason
- Implementing interaction checks as toast notifications
- Using `any` types for drug or clinical data
- Hardcoding interaction pairs instead of using a maintainable data structure
- Silently catching errors in CDSS engine (must surface failures loudly)
- Skipping weight-based validation when weight is not available (must block, not pass)

## Examples

### Example 1: Drug Interaction Check

```typescript
const alerts = checkInteractions('warfarin', ['aspirin', 'metformin'], ['penicillin']);
// [{ severity: 'critical', pair: ['warfarin', 'aspirin'],
//    message: 'Increased bleeding risk', recommendation: 'Avoid combination' }]
```

### Example 2: Dose Validation

```typescript
const ok = validateDose('paracetamol', 1000, 'oral', 70, 45);
// { valid: true, suggestedRange: { min: 500, max: 4000, unit: 'mg' } }

const bad = validateDose('paracetamol', 5000, 'oral', 70, 45);
// { valid: false, message: 'Exceeds absolute max 4000mg' }

const noWeight = validateDose('gentamicin', 300, 'iv');
// { valid: false, factors: ['weight_missing'] }
```

### Example 3: NEWS2 Scoring

```typescript
const result = calculateNEWS2({
  respiratoryRate: 24, oxygenSaturation: 93, supplementalOxygen: true,
  temperature: 38.5, systolicBP: 100, heartRate: 110, consciousness: 'voice'
});
// { total: 13, risk: 'high', escalation: 'Urgent clinical review. Consider ICU.' }
```
