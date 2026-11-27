---
name: healthcare-cdss-patterns
description: 临床决策支持系统（CDSS）开发模式。药物相互作用检查、剂量验证、临床评分（NEWS2、qSOFA）、警报严重性分类以及集成到电子病历工作流程中。
origin: Health1 Super Speciality Hospitals — contributed by Dr. Keyur Patel
version: "1.0.0"
---

# 医疗CDSS开发模式

构建可集成至EMR工作流的临床决策支持系统的模式。CDSS模块关乎患者安全——对假阴性零容忍。

## 适用场景

* 实现药物相互作用检查
* 构建剂量验证引擎
* 实现临床评分系统（NEWS2、qSOFA、APACHE、GCS）
* 设计异常临床值警报系统
* 构建带安全校验的用药医嘱录入
* 结合临床上下文解读检验结果

## 工作原理

CDSS引擎是一个**无副作用的纯函数库**。输入临床数据，输出警报。这使得它完全可测试。

三个核心模块：

1. **`checkInteractions(newDrug, currentMeds, allergies)`** — 检查新药物与现有用药及已知过敏的冲突。返回按严重程度排序的`InteractionAlert[]`。使用`DrugInteractionPair`数据模型。
2. **`validateDose(drug, dose, route, weight, age, renalFunction)`** — 根据体重、年龄和肾功能调整规则验证处方剂量。返回`DoseValidationResult`。
3. **`calculateNEWS2(vitals)`** — 基于`NEWS2Input`计算国家早期预警评分2。返回包含总分、风险等级和升级指导的`NEWS2Result`。

```
EMR UI
  ↓ (用户输入数据)
CDSS 引擎（纯函数，无副作用）
  ├── 药物相互作用检查器
  ├── 剂量验证器
  ├── 临床评分（NEWS2、qSOFA 等）
  └── 警报分类器
  ↓ (返回警报)
EMR UI（内联显示警报，严重时阻止操作）
```

### 药物相互作用检查

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

相互作用对必须**双向**：若药物A与药物B相互作用，则药物B与药物A相互作用。

### 剂量验证

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

### 临床评分：NEWS2

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

评分表必须严格符合皇家内科医师学会规范。

### 警报严重程度与UI行为

| 严重程度 | UI行为 | 临床医生操作要求 |
|----------|--------|------------------|
| 危急 | 阻止操作。不可关闭的模态框。红色。 | 必须记录覆盖原因才能继续 |
| 主要 | 行内警告横幅。橙色。 | 必须确认后才能继续 |
| 次要 | 行内信息提示。黄色。 | 仅需知晓，无需操作 |

危急警报**绝不能**自动关闭或实现为Toast通知。覆盖原因必须存储在审计追踪中。

### 测试CDSS（对假阴性零容忍）

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

通过标准：100%。一次遗漏的相互作用即构成患者安全事件。

### 反模式

* 使CDSS检查变为可选或可跳过且无记录原因
* 将相互作用检查实现为Toast通知
* 使用`any`类型处理药物或临床数据
* 硬编码相互作用对而非使用可维护的数据结构
* 静默捕获CDSS引擎错误（必须大声暴露失败）
* 在体重数据缺失时跳过基于体重的验证（必须阻止，而非通过）

## 示例

### 示例1：药物相互作用检查

```typescript
const alerts = checkInteractions('warfarin', ['aspirin', 'metformin'], ['penicillin']);
// [{ severity: 'critical', pair: ['warfarin', 'aspirin'],
//    message: 'Increased bleeding risk', recommendation: 'Avoid combination' }]
```

### 示例2：剂量验证

```typescript
const ok = validateDose('paracetamol', 1000, 'oral', 70, 45);
// { valid: true, suggestedRange: { min: 500, max: 4000, unit: 'mg' } }

const bad = validateDose('paracetamol', 5000, 'oral', 70, 45);
// { valid: false, message: 'Exceeds absolute max 4000mg' }

const noWeight = validateDose('gentamicin', 300, 'iv');
// { valid: false, factors: ['weight_missing'] }
```

### 示例3：NEWS2评分

```typescript
const result = calculateNEWS2({
  respiratoryRate: 24, oxygenSaturation: 93, supplementalOxygen: true,
  temperature: 38.5, systolicBP: 100, heartRate: 110, consciousness: 'voice'
});
// { total: 13, risk: 'high', escalation: 'Urgent clinical review. Consider ICU.' }
```
