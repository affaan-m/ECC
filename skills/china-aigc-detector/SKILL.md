---
name: china-aigc-detector
description: Detect AI-generated content (AIGC) in Chinese text and assess compliance with 2025 AI content labeling regulations (深度合成标识规定). Check if content requires AI-generated labels per Chinese law. Use when verifying content authenticity or ensuring AIGC labeling compliance.
origin: ECC
---

# China AIGC Detector (AI生成内容检测+标识合规)

Detect AI-generated Chinese content and ensure compliance with China's 2025 mandatory AI content labeling regulations.

## When to Activate

- Checking if Chinese text was AI-generated (ChatGPT, DeepSeek, 文心一言, etc.)
- Ensuring content complies with 2025 深度合成标识规定 (AI content labeling law)
- Verifying competitor content authenticity
- Auditing published content for AIGC labeling compliance
- Reviewing user-generated content for AI usage

## Core Concepts

### 2025 AI Content Labeling Law (深度合成标识规定)

Effective January 2025, China requires:
- **All AI-generated content** must be clearly labeled
- **Explicit labels**: Visible watermark or text indicator (e.g., "AI生成")
- **Implicit labels**: Machine-readable metadata in file headers
- **Platform responsibility**: Platforms must detect and label unlabeled AIGC
- **Fines**: 1-10万 for individuals, 10-100万 for organizations

### AIGC Detection Signals

| Signal | Weight | Description |
|--------|--------|-------------|
| Perplexity variance | High | AI text has low perplexity variance (too uniform) |
| Repetition patterns | Medium | AI tends to repeat sentence structures |
| Vocabulary distribution | Medium | AI uses more formal/uniform vocabulary |
| Coherence jumps | Low | AI may have subtle logical inconsistencies |
| Factual consistency | Low | AI may generate plausible but incorrect details |

## How It Works

### Step 1: Analyze the Text

```bash
# Check if text is AI-generated
./detect.sh "要检测的中文文本"

# Check with detailed analysis
./detect.sh "要检测的中文文本" --verbose
```

### Step 2: Interpret Results

| Score | Verdict | Action |
|-------|---------|--------|
| 0-20% | 🟢 Likely human | No labeling required |
| 20-40% | 🟡 Possibly AI-assisted | Consider labeling |
| 40-60% | 🟠 Likely AI-generated | Labeling recommended |
| 60-100% | 🔴 Highly likely AI | **Labeling required by law** |

### Step 3: Apply Compliance Labels

For content scoring >40%:
- Add explicit label: "本内容由AI辅助生成" or "AI生成内容"
- Add implicit label: Metadata with `aigc: true` and generator info
- Document in compliance records

## Anti-Patterns to Avoid

- **Relying on single signal**: Always use multiple detection signals
- **False confidence**: No detector is 100% accurate — always flag uncertainty
- **Ignoring context**: Academic writing naturally scores higher on AI detection
- **Skipping metadata labels**: Explicit labels alone don't satisfy the law — implicit labels are also required

## Best Practices Checklist

- [ ] Run AIGC detection on all published content
- [ ] Add explicit labels for content scoring >40%
- [ ] Add implicit metadata labels for machine-readable compliance
- [ ] Maintain detection records for audit purposes
- [ ] Re-detect after human editing (score may change)
- [ ] Train team on 2025 labeling requirements
- [ ] Set up automated detection pipeline for high-volume publishing

## Web App

👉 **https://1341839497-gi14eledh6.ap-shanghai.tencentscf.com/** — Online AIGC detection tool

## References

- [互联网信息服务深度合成管理规定 (2025)](https://www.cac.gov.cn/)
- [生成式人工智能服务管理暂行办法](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)
- [AIGC内容标识标准](https://www.tc260.org.cn/)

## Related Skills

- `china-compliance-guard` — Check content for advertising law violations
- `china-geo-audit` — Audit brand visibility in Chinese AI search
- `china-data-export` — Assess cross-border data transfer compliance
