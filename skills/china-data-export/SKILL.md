---
name: china-data-export
description: Assess cross-border data transfer compliance for Chinese regulations (数据出境安全评估/个人信息保护法/网络安全法). Check if your data flows require CAC security assessment, standard contract filing, or certification. Use when handling user data that crosses Chinese borders.
origin: ECC
---

# China Data Export Compliance (数据出境合规)

Assess whether your data flows comply with Chinese cross-border data transfer regulations and determine the required compliance pathway.

## When to Activate

- Building applications that transfer Chinese user data overseas
- Evaluating SaaS products for Chinese market compliance
- Assessing if data flows require CAC (网信办) security assessment
- Reviewing data processing agreements for Chinese regulations
- Checking compliance with 个人信息保护法 (PIPL), 网络安全法, 数据安全法

## Core Concepts

### Three Compliance Pathways

| Pathway | Threshold | Process | Timeline |
|---------|-----------|---------|----------|
| **Security Assessment** (安全评估) | CIIO, >1M users, or cumulative >10GB export | CAC review | 45-60 working days |
| **Standard Contract** (标准合同) | <1M users, <10GB export, non-CIIO | File contract with CAC | 10 working days |
| **Certification** (认证) | Voluntary, for recurring transfers | Third-party audit | 3-6 months |

### Data Categories by Sensitivity

| Category | Examples | Export Rules |
|----------|----------|-------------|
| **Important Data** (重要数据) | Industry statistics, geographic data | Must undergo security assessment |
| **Personal Info** (个人信息) | Name, phone, email, IP address | Consent + impact assessment required |
| **Sensitive Personal Info** (敏感个人信息) | ID, biometrics, health, financial | Strict consent + security assessment likely |
| **General Data** (一般数据) | Non-personal, non-important | Standard contract usually sufficient |

## How It Works

### Step 1: Identify Data Flows

Map all data that crosses Chinese borders:
- Where is data collected? (China)
- Where is data processed? (Overseas servers, cloud APIs)
- Where is data stored? (AWS, GCP, Azure regions)
- Who accesses the data? (Overseas team, third-party APIs)

### Step 2: Classify Data Types

For each data flow, classify:
- Personal information count (how many users affected)
- Data sensitivity level (general / personal / sensitive / important)
- Volume (total data exported)
- Frequency (one-time / recurring)

### Step 3: Determine Compliance Pathway

```
Is the organization a CIIO (关键信息基础设施运营者)?
├── Yes → Security Assessment (mandatory)
└── No → Does the export involve >1M users' personal info?
    ├── Yes → Security Assessment (mandatory)
    └── No → Is cumulative export >10GB?
        ├── Yes → Security Assessment (mandatory)
        └── No → Standard Contract or Certification
```

### Step 4: Implement Required Measures

- **Data Protection Impact Assessment** (个人信息保护影响评估) — required for ALL pathways
- **Separate consent** for sensitive personal information export
- **Standard contract filing** with local CAC office
- **Data export log** maintained for at least 3 years

## Anti-Patterns to Avoid

- **Assuming cloud = overseas**: 阿里云/AWS China regions are domestic; AWS Hong Kong may be considered cross-border
- **Ignoring API calls**: Calling overseas LLM APIs (OpenAI, Anthropic) with Chinese user data = data export
- **Skipping impact assessment**: Required even for standard contract pathway
- **Relying on consent alone**: Consent is necessary but not sufficient — you still need a compliance pathway

## Best Practices Checklist

- [ ] Map all data flows that cross Chinese borders (including API calls)
- [ ] Count affected users and data volume
- [ ] Classify data by sensitivity level
- [ ] Determine required compliance pathway
- [ ] Complete Personal Information Protection Impact Assessment
- [ ] Obtain separate consent for sensitive data export
- [ ] File standard contract or apply for security assessment
- [ ] Maintain data export logs for 3+ years
- [ ] Re-assess when data volumes change significantly

## Web App

👉 **https://1341839497-72h2iknf4m.ap-shanghai.tencentscf.com/** — Online data export compliance checker

## References

- [数据出境安全评估办法 (2022)](https://www.cac.gov.cn/2022-07/07/c_1658440919865321.htm)
- [个人信息出境标准合同办法 (2023)](https://www.cac.gov.cn/2023-02/24/c_1679013258279469.htm)
- [个人信息保护法 (PIPL)](https://www.gov.cn/xinwen/2021-08/20/content_5622486.htm)

## Related Skills

- `china-compliance-guard` — Check content for advertising law violations
- `china-geo-audit` — Audit brand visibility in Chinese AI search
- `china-aigc-detector` — Detect AI-generated content
