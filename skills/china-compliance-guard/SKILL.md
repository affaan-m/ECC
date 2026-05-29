---
name: china-compliance-guard
description: Scan Chinese text for 200+ banned words across 6 legal categories (广告法/消费者权益保护法), check SEO compliance for 5 platforms (百度/小红书/抖音/淘宝/京东), and provide safe replacement suggestions. Use when writing or reviewing Chinese marketing copy, product descriptions, or social media content for Chinese platforms.
origin: ECC
---

# China Compliance Guard (中国内容合规守卫)

Ensure Chinese content is legally safe for publication on mainland platforms by detecting banned words, checking SEO compliance, and providing safe replacements.

## When to Activate

- Writing or reviewing Chinese marketing copy, product descriptions, or ad text
- Publishing content on Chinese platforms (抖音, 小红书, 淘宝, 京东, 百度)
- Checking if Chinese text violates advertising law (广告法)
- Replacing banned words with safe alternatives before publication
- Auditing existing content for compliance gaps

## 🚨 HARD RULE — Always Execute First

When user provides ANY Chinese text for compliance checking:
1. **RUN the check script FIRST** — `./check.sh "<text>" --platform <platform>`
2. **THEN** supplement with the analysis below
3. **NEVER** just list guidelines — always produce actionable results

## Core Concepts

### The 6 Legal Categories

| Category | Chinese | Examples | Fine Range |
|----------|---------|----------|------------|
| Absolute claims | 绝对化用语 | 最好, 第一, 极致 | 20-100万 |
| Medical promises | 医疗效果承诺 | 治愈, 根治, 药到病除 | 20-100万 |
| False advertising | 虚假宣传 | 100%有效, 零风险 | 20-100万 |
| Financial promises | 金融承诺 | 保本保息, 稳赚不赔 | 20-100万 |
| Inducing consumption | 诱导消费 | 限时抢购, 仅剩最后 | 5-20万 |
| Comparative advertising | 比较广告 | 比XX好, 行业第一 | 5-20万 |

### Platform-Specific SEO Rules

| Platform | Title Length | Keyword Density | Special Rules |
|----------|-------------|-----------------|---------------|
| 百度 | 15-30字 | 2-5% | 需ICP备案, 百家号优先 |
| 小红书 | 8-20字 | 3-8% | 禁止导流微信, 真实体验 |
| 抖音 | 10-30字 | 1-3% | 视频描述>标题, 话题标签 |
| 淘宝 | 30-60字 | 3-5% | 属性词+卖点词+促销词 |
| 京东 | 20-40字 | 2-4% | 品牌词+核心卖点 |

## How It Works

### Step 1: Run the API Check

```bash
# Instant compliance check
./check.sh "你的文案内容" --platform douyin

# Check with all platforms
./check.sh "你的文案内容" --platform all

# Get replacement suggestions
./suggestions.sh --keyword "最好"
```

### Step 2: Analyze Results

The API returns:
- **Banned words found** with severity (高/中/低) and legal citation
- **SEO issues** specific to the target platform
- **Safe replacements** for each banned word

### Step 3: Apply Safe Replacements

| Banned Word | Safe Alternatives |
|-------------|-------------------|
| 最好 | 优选, 值得推荐 |
| 第一 | 领先, 优秀 |
| 极致 | 卓越, 出色 |
| 100%有效 | 效果显著, 备受好评 |
| 限时抢购 | 限时优惠, 专属福利 |

## Anti-Patterns to Avoid

- **Ignoring context**: "第一" in "第一次使用" is fine; "销量第一" is not
- **Platform mismatch**: 抖音 rules ≠ 淘宝 rules — always specify the platform
- **Replacing without checking**: Some replacements may also be banned in certain contexts
- **Skipping medical/financial categories**: These carry the highest fines (20-100万)

## Best Practices Checklist

- [ ] Run `./check.sh` before publishing ANY Chinese marketing content
- [ ] Specify the correct platform for SEO-specific rules
- [ ] Replace ALL high-severity (高) banned words
- [ ] Verify replacements don't introduce new violations
- [ ] Keep records for audit compliance (Pro users get hash-chained audit trail)
- [ ] Re-check quarterly — platform rules and regulations change frequently

## Web App

👉 **https://1341839497-jv04655vcs.ap-shanghai.tencentscf.com/** — Online compliance checker, no installation needed

## References

- [中华人民共和国广告法 (2023修订)](https://www.gov.cn/guoqing/2021-10/29/content_5647737.htm)
- [互联网广告管理办法 (2023)](https://www.samr.gov.cn/xw/zj/202302/t20230225_352890.html)
- [AI内容标注新规 (2025)](https://www.cac.gov.cn/)

## Related Skills

- `china-geo-audit` — Check if your brand appears in Chinese AI search results
- `china-aigc-detector` — Detect AI-generated content (must label per 2025 regulations)
- `china-data-export` — Assess cross-border data transfer compliance
