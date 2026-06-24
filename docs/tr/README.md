# Everything Claude Code

[![Stars](https://img.shields.io/github/stars/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/stargazers)
[![Forks](https://img.shields.io/github/forks/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/network/members)
[![Contributors](https://img.shields.io/github/contributors/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/graphs/contributors)
[![npm ecc-universal](https://img.shields.io/npm/dw/ecc-universal?label=ecc-universal%20haftalık%20indirme&logo=npm)](https://www.npmjs.com/package/ecc-universal)
[![npm ecc-agentshield](https://img.shields.io/npm/dw/ecc-agentshield?label=ecc-agentshield%20haftalık%20indirme&logo=npm)](https://www.npmjs.com/package/ecc-agentshield)
[![GitHub App Install](https://img.shields.io/badge/GitHub%20App-150%20kurulum-2ea44f?logo=github)](https://github.com/marketplace/ecc-tools)
[![License](https://img.shields.io/badge/lisans-MIT-blue.svg)](../../LICENSE)
![Shell](https://img.shields.io/badge/-Shell-4EAA25?logo=gnu-bash&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)
![Go](https://img.shields.io/badge/-Go-00ADD8?logo=go&logoColor=white)
![Java](https://img.shields.io/badge/-Java-ED8B00?logo=openjdk&logoColor=white)
![Perl](https://img.shields.io/badge/-Perl-39457E?logo=perl&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown&logoColor=white)

> **140K+ yıldız** | **21K+ fork** | **170+ katkıda bulunan** | **12+ dil ekosistemi** | **Anthropic Hackathon Kazananı**

---

<div align="center">

**Dil / Language / 语言 / 語言 / Язык / Ngôn ngữ**

[**English**](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](../ko-KR/README.md) | [**Türkçe**](README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md) | [Deutsch](../de-DE/README.md)

</div>

---

**AI agent harness'ları için performans optimizasyon sistemi. Anthropic hackathon kazananından.**

Sadece konfigürasyon dosyaları değil. Tam bir sistem: skill'ler, instinct'ler, memory optimizasyonu, sürekli öğrenme, güvenlik taraması ve araştırma odaklı geliştirme. 10+ ay boyunca gerçek ürünler inşa ederken yoğun günlük kullanımla evrimleşmiş production-ready agent'lar, hook'lar, command'lar, rule'lar ve MCP konfigürasyonları.

**Claude Code**, **Codex**, **Cursor**, **OpenCode**, **Gemini** ve diğer AI agent harness'larında çalışır.

---

## Rehberler

Bu repository yalnızca ham kodu içerir. Rehberler her şeyi açıklıyor.

<table>
<tr>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2012378465664745795">
<img src="../../assets/images/guides/shorthand-guide.png" alt="Everything Claude Code Kısa Rehberi" />
</a>
</td>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2014040193557471352">
<img src="../../assets/images/guides/longform-guide.png" alt="Everything Claude Code Uzun Rehberi" />
</a>
</td>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2033263813387223421">
<img src="../../assets/images/security/security-guide-header.png" alt="Agentic Güvenlik Kısa Rehberi" />
</a>
</td>
</tr>
<tr>
<td align="center"><b>Kısa Rehber</b><br/>Kurulum, temeller, felsefe. <b>İlk önce bunu okuyun.</b></td>
<td align="center"><b>Uzun Rehber</b><br/>Token optimizasyonu, memory kalıcılığı, eval'ler, paralelleştirme.</td>
<td align="center"><b>Güvenlik Rehberi</b><br/>Saldırı vektörleri, sandboxing, sanitizasyon, CVE'ler, AgentShield.</td>
</tr>
</table>

| Konu | Öğrenecekleriniz |
|------|------------------|
| Token Optimizasyonu | Model seçimi, system prompt daraltma, background process'ler |
| Memory Kalıcılığı | Oturumlar arası bağlamı otomatik kaydet/yükle hook'ları |
| Sürekli Öğrenme | Oturumlardan otomatik pattern çıkarma ve yeniden kullanılabilir skill'lere dönüştürme |
| Verification Loop'ları | Checkpoint vs sürekli eval'ler, grader tipleri, pass@k metrikleri |
| Paralelleştirme | Git worktree'ler, cascade metodu, instance'ları ne zaman ölçeklendirmeli |
| Subagent Orkestrasyonu | Context problemi, iterative retrieval pattern |

---

## Yenilikler

### v2.0.0 — Ajan Harness İşletim Sistemi (Haz 2026)

2.0 hattının kararlı sürümü: 261 skill, control-pane altyapısı, MCP envanteri, worktree yaşam döngüsü servisi ve [Discord topluluğu](https://discord.gg/36yGMHGFbR).

### v2.0.0-rc.1 — Surface Sync, Operatör İş Akışları ve ECC 2.0 Alpha (Nis 2026)

- **Public surface canlı repo ile senkronlandı** — metadata, katalog sayıları, plugin manifest'leri ve kurulum odaklı dokümanlar artık gerçek OSS yüzeyiyle eşleşiyor.
- **Operatör ve dışa dönük iş akışları büyüdü** — `brand-voice`, `social-graph-ranker`, `customer-billing-ops`, `google-workspace-ops` ve ilgili operatör skill'leri aynı sistem içinde tamamlandı.
- **Medya ve lansman araçları** — `manim-video`, `remotion-video-creation` ve sosyal yayın yüzeyleri teknik anlatım ve duyuru akışlarını aynı repo içine taşıdı.
- **Framework ve ürün yüzeyi genişledi** — `nestjs-patterns`, daha zengin Codex/OpenCode kurulum yüzeyleri ve çapraz harness paketleme iyileştirmeleri repo'yu Claude Code dışına da taşıdı.
- **ECC 2.0 alpha repoda** — `ecc2/` altındaki Rust kontrol katmanı artık yerelde derleniyor ve `dashboard`, `start`, `sessions`, `status`, `stop`, `resume` ve `daemon` komutlarını sunuyor.
- **Ekosistem sağlamlaştırma** — AgentShield, ECC Tools maliyet kontrolleri, billing portal işleri ve web yüzeyi çekirdek plugin etrafında birlikte gelişmeye devam ediyor.

### v1.9.0 — Seçici Kurulum & Dil Genişlemesi (Mar 2026)

- **Seçici kurulum mimarisi** — `install-plan.js` ve `install-apply.js` ile manifest-tabanlı kurulum pipeline'ı, hedefli component kurulumu için. State store neyin kurulu olduğunu takip eder ve artımlı güncellemelere olanak sağlar.
- **6 yeni agent** — `typescript-reviewer`, `pytorch-build-resolver`, `java-build-resolver`, `java-reviewer`, `kotlin-reviewer`, `kotlin-build-resolver` dil desteğini 10 dile çıkarıyor.
- **Yeni skill'ler** — Deep learning iş akışları için `pytorch-patterns`, API referans araştırması için `documentation-lookup`, modern JS toolchain'leri için `bun-runtime` ve `nextjs-turbopack`, artı 8 operasyonel domain skill ve `mcp-server-patterns`.
- **Session & state altyapısı** — Query CLI ile SQLite state store, yapılandırılmış kayıt için session adapter'ları, kendini geliştiren skill'ler için skill evolution foundation.
- **Orkestrasyon iyileştirmesi** — Harness audit skorlaması deterministik hale getirildi, orkestrasyon durumu ve launcher uyumluluğu sağlamlaştırıldı, 5 katmanlı koruma ile observer loop önleme.
- **Observer güvenilirliği** — Throttling ve tail sampling ile memory patlaması düzeltmesi, sandbox erişim düzeltmesi, lazy-start mantığı ve re-entrancy koruması.
- **12 dil ekosistemi** — Mevcut TypeScript, Python, Go ve genel rule'lara Java, PHP, Perl, Kotlin/Android/KMP, C++ ve Rust için yeni rule'lar eklendi.
- **Topluluk katkıları** — Korece ve Çince çeviriler, security hook, biome hook optimizasyonu, video işleme skill'leri, operasyonel skill'ler, PowerShell installer, Antigravity IDE desteği.
- **CI sağlamlaştırma** — 19 test hatası düzeltmesi, katalog sayısı zorunluluğu, kurulum manifest validasyonu ve tam test suite yeşil.

### v1.8.0 — Harness Performans Sistemi (Mar 2026)

- **Harness-first release** — ECC artık açıkça bir agent harness performans sistemi olarak çerçevelendi, sadece bir config paketi değil.
- **Hook güvenilirlik iyileştirmesi** — SessionStart root fallback, Stop-phase session özetleri ve kırılgan inline one-liner'lar yerine script-tabanlı hook'lar.
- **Hook runtime kontrolleri** — `ECC_HOOK_PROFILE=minimal|standard|strict` ve `ECC_DISABLED_HOOKS=...` hook dosyalarını düzenlemeden runtime gating için.
- **Yeni harness command'ları** — `/harness-audit`, `/loop-start`, `/loop-status`, `/quality-gate`, `/model-route`.
- **NanoClaw v2** — Model routing, skill hot-load, session branch/search/export/compact/metrics.
- **Çapraz harness paritesi** — Claude Code, Cursor, OpenCode ve Codex app/CLI arasında davranış sıkılaştırıldı.
- **997 internal test geçiyor** — Hook/runtime refactor ve uyumluluk güncellemelerinden sonra tam suite yeşil.

[Tam değişiklik günlüğü için Releases bölümüne bakın](https://github.com/affaan-m/everything-claude-code/releases).

---

## Hızlı Başlangıç

2 dakikadan kısa sürede başlayın:

### Adım 1: Plugin'i Kurun

```bash
# Marketplace ekle
/plugin marketplace add https://github.com/affaan-m/ECC

# Plugin'i kur
/plugin install ecc@ecc
```

### Adım 2: Rule'ları Kurun (Gerekli)

> WARNING: **Önemli:** Claude Code plugin'leri `rule`'ları otomatik olarak dağıtamaz. Manuel olarak kurmalısınız:

```bash
# Önce repo'yu klonlayın
git clone https://github.com/affaan-m/everything-claude-code.git
cd everything-claude-code

# Bağımlılıkları kurun (paket yöneticinizi seçin)
npm install        # veya: pnpm install | yarn install | bun install

# macOS/Linux
./install.sh typescript    # veya python veya golang veya swift veya php
# ./install.sh typescript python golang swift php
# ./install.sh --target cursor typescript
# ./install.sh --target antigravity typescript
```

```powershell
# Windows PowerShell
.\install.ps1 typescript   # veya python veya golang veya swift veya php
# .\install.ps1 typescript python golang swift php
# .\install.ps1 --target cursor typescript
# .\install.ps1 --target antigravity typescript

# npm-installed uyumluluk entry point'i de çapraz platform çalışır
npx ecc-install typescript
```

Manuel kurulum talimatları için `rules/` klasöründeki README'ye bakın.

### Adım 3: Kullanmaya Başlayın

```bash
# Bir command deneyin (plugin kurulumu namespace'li form kullanır)
/ecc:plan "Kullanıcı kimlik doğrulaması ekle"

# Manuel kurulum (Seçenek 2) daha kısa formu kullanır:
# /plan "Kullanıcı kimlik doğrulaması ekle"

# Mevcut command'ları kontrol edin
/plugin list ecc@ecc
```

**Bu kadar!** Artık 28 agent, 116 skill ve 59 command'a erişiminiz var.

---

## Çapraz Platform Desteği

Bu plugin artık **Windows, macOS ve Linux**'u tam olarak destekliyor, ana IDE'ler (Cursor, OpenCode, Antigravity) ve CLI harness'lar arasında sıkı entegrasyon ile birlikte. Tüm hook'lar ve script'ler maksimum uyumluluk için Node.js ile yeniden yazıldı.

### Paket Yöneticisi Algılama

Plugin, tercih ettiğiniz paket yöneticisini (npm, pnpm, yarn veya bun) otomatik olarak algılar, aşağıdaki öncelik sırasıyla:

1. **Ortam değişkeni**: `CLAUDE_PACKAGE_MANAGER`
2. **Proje config**: `.claude/package-manager.json`
3. **package.json**: `packageManager` alanı
4. **Lock dosyası**: package-lock.json, yarn.lock, pnpm-lock.yaml veya bun.lockb'den algılama
5. **Global config**: `~/.claude/package-manager.json`
6. **Fallback**: İlk mevcut paket yöneticisi

Tercih ettiğiniz paket yöneticisini ayarlamak için:

```bash
# Ortam değişkeni ile
export CLAUDE_PACKAGE_MANAGER=pnpm

# Global config ile
node scripts/setup-package-manager.js --global pnpm

# Proje config ile
node scripts/setup-package-manager.js --project bun

# Mevcut ayarı algıla
node scripts/setup-package-manager.js --detect
```

Veya Claude Code'da `/setup-pm` command'ını kullanın.

### Hook Runtime Kontrolleri

Sıkılığı ayarlamak veya belirli hook'ları geçici olarak devre dışı bırakmak için runtime flag'lerini kullanın:

```bash
# Hook sıkılık profili (varsayılan: standard)
export ECC_HOOK_PROFILE=standard

# Devre dışı bırakılacak hook ID'leri (virgülle ayrılmış)
export ECC_DISABLED_HOOKS="pre:bash:tmux-reminder,post:edit:typecheck"
```

---

## İçindekiler

Bu repo bir **Claude Code plugin'i** - doğrudan kurun veya component'leri manuel olarak kopyalayın.

```
everything-claude-code/
|-- .claude-plugin/   # Plugin ve marketplace manifest'leri
|   |-- plugin.json         # Plugin metadata ve component path'leri
|   |-- marketplace.json    # /plugin marketplace add için marketplace kataloğu
|
|-- agents/           # Delegation için 28 özel subagent
|   |-- planner.md           # Feature implementasyon planlama
|   |-- architect.md         # Sistem tasarım kararları
|   |-- tdd-guide.md         # Test-driven development
|   |-- code-reviewer.md     # Kalite ve güvenlik incelemesi
|   |-- security-reviewer.md # Güvenlik açığı analizi
|   |-- build-error-resolver.md
|   |-- e2e-runner.md        # Playwright E2E testing
|   |-- refactor-cleaner.md  # Ölü kod temizleme
|   |-- doc-updater.md       # Dokümantasyon senkronizasyonu
|   |-- docs-lookup.md       # Dokümantasyon/API arama
|   |-- chief-of-staff.md    # İletişim triajı ve taslaklar
|   |-- loop-operator.md     # Otonom loop çalıştırma
|   |-- harness-optimizer.md # Harness config ayarlama
|   |-- ve daha fazlası...
|
|-- skills/           # İş akışı tanımları ve domain bilgisi
|   |-- coding-standards/           # Dil en iyi uygulamaları
|   |-- backend-patterns/           # API, veritabanı, caching pattern'leri
|   |-- frontend-patterns/          # React, Next.js pattern'leri
|   |-- security-review/            # Güvenlik kontrol listesi
|   |-- tdd-workflow/               # TDD metodolojisi
|   |-- continuous-learning/        # Oturumlardan otomatik pattern çıkarma
|   |-- django-patterns/            # Django pattern'leri
|   |-- golang-patterns/            # Go deyimleri ve en iyi uygulamalar
|   |-- ve 100+ daha fazla skill...
|
|-- commands/         # Hızlı çalıştırma için slash command'lar
|   |-- tdd.md              # /tdd - Test-driven development
|   |-- plan.md             # /plan - Implementasyon planlama
|   |-- e2e.md              # /e2e - E2E test oluşturma
|   |-- code-review.md      # /code-review - Kalite incelemesi
|   |-- build-fix.md        # /build-fix - Build hatalarını düzelt
|   |-- ve 50+ daha fazla command...
|
|-- rules/            # Her zaman uyulması gereken kurallar (~/.claude/rules/ içine kopyalayın)
|   |-- README.md            # Yapı genel bakışı ve kurulum rehberi
|   |-- common/              # Dilden bağımsız prensipler
|   |   |-- coding-style.md    # Immutability, dosya organizasyonu
|   |   |-- git-workflow.md    # Commit formatı, PR süreci
|   |   |-- testing.md         # TDD, %80 coverage gereksinimi
|   |   |-- performance.md     # Model seçimi, context yönetimi
|   |   |-- patterns.md        # Tasarım pattern'leri
|   |   |-- hooks.md           # Hook mimarisi
|   |   |-- agents.md          # Ne zaman subagent'lara delege edilmeli
|   |   |-- security.md        # Zorunlu güvenlik kontrolleri
|   |-- typescript/          # TypeScript/JavaScript özel
|   |-- python/              # Python özel
|   |-- golang/              # Go özel
|   |-- swift/               # Swift özel
|   |-- php/                 # PHP özel
|
|-- hooks/            # Trigger-tabanlı otomasyonlar
|   |-- hooks.json                # Tüm hook'ların config'i
|   |-- memory-persistence/       # Session lifecycle hook'ları
|   |-- strategic-compact/        # Compaction önerileri
|
|-- scripts/          # Çapraz platform Node.js script'leri
|   |-- lib/                     # Paylaşılan yardımcılar
|   |-- hooks/                   # Hook implementasyonları
|   |-- setup-package-manager.js # Interaktif PM kurulumu
|
|-- mcp-configs/      # MCP server konfigürasyonları
|   |-- mcp-servers.json    # GitHub, Supabase, Vercel, Railway, vb.
```

---

## Hangi Agent'ı Kullanmalıyım?

Nereden başlayacağınızdan emin değil misiniz? Bu hızlı referansı kullanın:

| Yapmak istediğim... | Bu command'ı kullan | Kullanılan agent |
|---------------------|---------------------|------------------|
| Yeni bir feature planla | `/ecc:plan "Auth ekle"` | planner |
| Sistem mimarisi tasarla | `/ecc:plan` + architect agent | architect |
| Önce testlerle kod yaz | `/tdd` | tdd-guide |
| Yazdığım kodu incele | `/code-review` | code-reviewer |
| Başarısız bir build'i düzelt | `/build-fix` | build-error-resolver |
| End-to-end testler çalıştır | `/e2e` | e2e-runner |
| Güvenlik açıklarını bul | `/security-scan` | security-reviewer |
| Ölü kodu kaldır | `/refactor-clean` | refactor-cleaner |
| Dokümantasyonu güncelle | `/update-docs` | doc-updater |
| Go kodu incele | `/go-review` | go-reviewer |
| Python kodu incele | `/python-review` | python-reviewer |

### Yaygın İş Akışları

**Yeni bir feature başlatma:**
```
/ecc:plan "OAuth ile kullanıcı kimlik doğrulaması ekle"
                                              → planner implementasyon planı oluşturur
/tdd                                          → tdd-guide önce-test-yaz'ı zorunlu kılar
/code-review                                  → code-reviewer çalışmanızı kontrol eder
```

**Bir hatayı düzeltme:**
```
/tdd                                          → tdd-guide: hatayı yeniden üreten başarısız bir test yaz
                                              → düzeltmeyi uygula, testin geçtiğini doğrula
/code-review                                  → code-reviewer: regresyonları yakala
```

**Production'a hazırlanma:**
```
/security-scan                                → security-reviewer: OWASP Top 10 denetimi
/e2e                                          → e2e-runner: kritik kullanıcı akışı testleri
/test-coverage                                → %80+ coverage doğrula
```

---

## SSS

<details>
<summary><b>Hangi agent/command'ların kurulu olduğunu nasıl kontrol ederim?</b></summary>

```bash
/plugin list ecc@ecc
```

Bu, plugin'den mevcut tüm agent'ları, command'ları ve skill'leri gösterir.
</details>

<details>
<summary><b>Hook'larım çalışmıyor / "Duplicate hooks file" hatası alıyorum</b></summary>

Bu en yaygın sorundur. `.claude-plugin/plugin.json`'a bir `"hooks"` alanı **EKLEMEYİN**. Claude Code v2.1+ kurulu plugin'lerden `hooks/hooks.json`'ı otomatik olarak yükler. Açıkça belirtmek duplicate algılama hatalarına neden olur. Bkz. [#29](https://github.com/affaan-m/everything-claude-code/issues/29), [#52](https://github.com/affaan-m/everything-claude-code/issues/52), [#103](https://github.com/affaan-m/everything-claude-code/issues/103).
</details>

<details>
<summary><b>Context window'um küçülüyor / Claude context'ten tükeniyor</b></summary>

Çok fazla MCP server context'inizi tüketiyor. Her MCP tool açıklaması 200k window'unuzdan token tüketir, potansiyel olarak ~70k'ya düşürür.

**Düzeltme:** Kullanılmayan MCP'leri proje başına devre dışı bırakın:
```json
// Projenizin .claude/settings.json dosyasında
{
  "disabledMcpServers": ["supabase", "railway", "vercel"]
}
```

10'dan az MCP etkin ve 80'den az aktif tool tutun.
</details>

<details>
<summary><b>Sadece bazı component'leri kullanabilir miyim (örn. sadece agent'lar)?</b></summary>

Evet. Seçenek 2'yi (manuel kurulum) kullanın ve yalnızca ihtiyacınız olanı kopyalayın:

```bash
# Sadece agent'lar
cp everything-claude-code/agents/*.md ~/.claude/agents/

# Sadece rule'lar
cp -r everything-claude-code/rules/common ~/.claude/rules/common
```

Her component tamamen bağımsızdır.
</details>

<details>
<summary><b>Bu Cursor / OpenCode / Codex / Antigravity ile çalışır mı?</b></summary>

Evet. ECC çapraz platformdur:
- **Cursor**: `.cursor/` içinde önceden çevrilmiş config'ler. [Cursor IDE Desteği](../../README.md#cursor-ide-support) bölümüne bakın.
- **OpenCode**: `.opencode/` içinde tam plugin desteği. [OpenCode Desteği](../../README.md#opencode-support) bölümüne bakın.
- **Codex**: macOS app ve CLI için birinci sınıf destek. PR [#257](https://github.com/affaan-m/everything-claude-code/pull/257)'ye bakın.
- **Antigravity**: İş akışları, skill'ler ve `.agent/` içinde düzleştirilmiş rule'lar için sıkı entegre kurulum.
- **Claude Code**: Native — bu birincil hedeftir.
</details>

<details>
<summary><b>Yeni bir skill veya agent'a nasıl katkıda bulunurum?</b></summary>

[CONTRIBUTING.md](../../CONTRIBUTING.md)'ye bakın. Kısa versiyon:
1. Repo'yu fork'layın
2. `skills/your-skill-name/SKILL.md` içinde skill'inizi oluşturun (YAML frontmatter ile)
3. Veya `agents/your-agent.md` içinde bir agent oluşturun
4. Ne yaptığını ve ne zaman kullanılacağını açıklayan net bir açıklamayla PR gönderin
</details>

---

## Testleri Çalıştırma

Plugin kapsamlı bir test suite içerir:

```bash
# Tüm testleri çalıştır
node tests/run-all.js

# Bireysel test dosyalarını çalıştır
node tests/lib/utils.test.js
node tests/lib/package-manager.test.js
node tests/hooks/hooks.test.js
```

---

## Katkıda Bulunma

**Katkılar beklenir ve teşvik edilir.**

Bu repo bir topluluk kaynağı olmayı amaçlar. Eğer şunlara sahipseniz:
- Yararlı agent'lar veya skill'ler
- Akıllı hook'lar
- Daha iyi MCP konfigürasyonları
- İyileştirilmiş rule'lar

Lütfen katkıda bulunun! Rehber için [CONTRIBUTING.md](../../CONTRIBUTING.md)'ye bakın.

### Katkı Fikirleri

- Dile özel skill'ler (Rust, C#, Kotlin, Java) — Go, Python, Perl, Swift ve TypeScript zaten dahil
- Framework'e özel config'ler (Rails, FastAPI) — Django, NestJS, Spring Boot ve Laravel zaten dahil
- DevOps agent'ları (Kubernetes, Terraform, AWS, Docker)
- Test stratejileri (farklı framework'ler, görsel regresyon)
- Domain'e özel bilgi (ML, data engineering, mobile)

---

## Lisans

MIT - Özgürce kullanın, ihtiyaç duyduğunuz gibi değiştirin, yapabiliyorsanız geri katkıda bulunun.

---

**Bu repo size yardımcı olduysa yıldızlayın. Her iki rehberi de okuyun. Harika bir şey yapın.**
