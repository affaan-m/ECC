---
name: china-geo-audit
description: Audit brand visibility across 5 Chinese AI search engines (DeepSeek/Kimi/豆包/通义千问/文心一言) with 0-100 scoring. Get per-engine citation logic analysis and GEO (Generative Engine Optimization) strategies for China market. Use when checking if a brand appears in Chinese AI search results.
origin: ECC
---

# China GEO Audit (中国AI搜索可见度审计)

Audit how visible a brand is to Chinese AI search engines and generate optimization strategies to improve citation rates.

## When to Activate

- User asks "can AI search find my brand?" or "品牌在AI搜索中可见吗?"
- Planning GEO (Generative Engine Optimization) strategy for China
- Checking brand visibility in DeepSeek, Kimi, 豆包, 通义千问, or 文心一言
- Comparing Chinese vs Western AI search visibility
- Monitoring competitor AI citation rates

## 🚨 HARD RULE — Always Execute First

When user asks about brand visibility in AI search:
1. **RUN the audit script FIRST** — `./check-visibility.sh "<brand>" --api`
2. **THEN** supplement with the citation logic analysis below
3. **NEVER** just explain theory — always produce a score and action plan

## Core Concepts

### The 5 Chinese AI Search Engines

Each engine has a **distinct citation logic** — understanding this is the key to GEO in China:

| Engine | Parent | Prefers | Ignores |
|--------|--------|---------|---------|
| **DeepSeek** | 深度求索 | Technical docs, GitHub, 学术论文 | Short-form content, 社交媒体 |
| **Kimi** | 月之暗面 | 长文深度分析, 知乎, 微信公众号 | 短视频, 电商描述 |
| **豆包** | 字节跳动 | 抖音视频字幕, 今日头条, 短评 | 长技术文档, 学术论文 |
| **通义千问** | 阿里巴巴 | 淘宝/天猫商品描述, 商业分析 | 纯技术内容无商业语境 |
| **文心一言** | 百度 | 百度索引内容, 百度百科, 百家号 | 未被百度收录的内容 |

### Visibility Score (0-100)

| Score | Grade | Meaning |
|-------|-------|---------|
| 80-100 | 🟢 优秀 | Brand appears frequently in AI search |
| 60-79 | 🟡 良好 | Visible in some queries, room to improve |
| 40-59 | 🟠 一般 | Needs systematic optimization |
| 20-39 | 🔴 较差 | Almost invisible in AI search |
| 0-19 | ⚫ 缺失 | No AI search presence at all |

## How It Works

### Step 1: Run the API Audit

```bash
# Full audit across all 5 engines
./check-visibility.sh "品牌名" --api

# Single engine audit
./check-visibility.sh "品牌名" --engine deepseek --api

# Predict visibility improvement
./predict.sh "品牌名" --engine kimi
```

### Step 2: Analyze Per-Engine Results

For each engine, the audit returns:
- **Visibility score** (0-100)
- **Citation triggers** (what queries cause citation)
- **Content gaps** (what content is missing)
- **Optimization actions** (specific steps to improve)

### Step 3: Apply Engine-Specific Optimization

**DeepSeek** → Publish technical docs on GitHub, write 学术论文 format content
**Kimi** → Write 长文深度分析 on 知乎/微信公众号, 2000+ words
**豆包** → Create 抖音 videos with keyword-rich descriptions, 500-1500字头条文章
**通义千问** → Optimize 淘宝 product titles, include 价格/参数/对比
**文心一言** → Submit sitemap to Baidu, create 百度百科 entries, publish on 百家号

## Anti-Patterns to Avoid

- **Applying Western GEO to China**: ChatGPT/Perplexity optimization ≠ DeepSeek/Kimi optimization
- **Ignoring 百度 indexing**: If Baidu can't find it, 文心一言 can't cite it
- **One-size-fits-all content**: Each engine prefers different content formats
- **Expecting instant results**: AI citation updates take 2-4 weeks after content changes

## Best Practices Checklist

- [ ] Run `./check-visibility.sh --api` to get baseline score
- [ ] Create engine-specific content for each of the 5 engines
- [ ] Ensure Baidu indexing for 文心一言 visibility
- [ ] Monitor score changes weekly
- [ ] Re-audit after content changes (2-4 week lag)
- [ ] Track competitor visibility scores for benchmarking

## Battle-Tested Results

A SaaS brand went from **0% → 47% AI citation rate in 30 days** using this methodology:
- Week 1: Baseline audit + content gap analysis
- Week 2: Published engine-specific content (知乎 for Kimi, GitHub for DeepSeek)
- Week 3: Baidu indexing optimization for 文心一言
- Week 4: 抖音 content for 豆包, 淘宝 optimization for 通义千问

## Web App

👉 **https://1341839497-1w5tkesfb0.ap-shanghai.tencentscf.com/** — Online GEO audit tool, no installation needed

## References

- [GEO: Generative Engine Optimization (Princeton Research)](https://arxiv.org/abs/2302.12824)
- [DeepSeek API Documentation](https://platform.deepseek.com/api-docs)
- [百度搜索资源平台](https://ziyuan.baidu.com/)

## Related Skills

- `china-compliance-guard` — Ensure content is legally compliant before publishing
- `china-aigc-detector` — Check if competitor content is AI-generated
- `china-data-export` — Required if visibility data crosses borders
