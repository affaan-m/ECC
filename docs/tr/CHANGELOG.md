# Değişiklik Günlüğü

## 2.0.0-rc.1 - 2026-04-28

### Öne Çıkanlar

- Hermes operatör hikayesi için genel ECC 2.0 sürüm adayı yüzeyi eklendi.
- ECC, Claude Code, Codex, Cursor, OpenCode ve Gemini genelinde yeniden kullanılabilir cross-harness altyapı olarak belgelendi.
- Özel operatör state'i yayımlamak yerine sanitize edilmiş Hermes import becerisi eklendi.

### Sürüm Yüzeyi

- Paket, plugin, marketplace, OpenCode, ajan ve README metadataları `2.0.0-rc.1` olarak güncellendi.
- Sürüm notları, sosyal taslaklar, launch checklist, handoff notları ve demo prompt'ları `docs/releases/2.0.0-rc.1/` altında toplandı.
- ECC/Hermes sınırı için `docs/architecture/cross-harness.md` ve regresyon kapsamı eklendi.
- `ecc2/` sürümlemesi bağımsız tutuldu; release engineering aksi karar vermedikçe alpha control-plane scaffold olarak kalır.

### Notlar

- Bu bir sürüm adayıdır; tam ECC 2.0 control-plane yol haritası için GA iddiası değildir.
- Ön sürüm npm yayımları, release engineering aksi karar vermedikçe `next` dist-tag kullanmalıdır.

## 1.10.0 - 2026-04-05

### Öne Çıkanlar

- Genel repo yüzeyi birkaç haftalık OSS büyümesi ve backlog merge'lerinden sonra canlı repo ile senkronize edildi.
- Operatör iş akışı hattı voice, graph-ranking, billing, workspace ve outbound becerileriyle genişletildi.
- Medya üretim hattı Manim ve Remotion odaklı launch araçlarıyla genişletildi.
- ECC 2.0 alpha control-plane binary artık `ecc2/` üzerinden yerelde build ediliyor ve ilk kullanılabilir CLI/TUI yüzeyini sunuyor.

### Sürüm Yüzeyi

- Plugin, marketplace, Codex, OpenCode ve ajan metadataları `1.10.0` olarak güncellendi.
- Yayınlanan sayımlar canlı OSS yüzeyine eşitlendi: 38 ajan, 156 beceri, 72 komut.
- Üst seviye install dokümanları ve marketplace açıklamaları mevcut repo durumuyla eşitlendi.

### Notlar

- Claude plugin'i platform seviyesindeki rules dağıtım kısıtlarıyla sınırlı kalır; selective install / OSS yolu hâlâ en güvenilir tam kurulum yoludur.
- Bu sürüm bir repo-yüzeyi düzeltmesi ve ekosistem senkronizasyonudur; tam ECC 2.0 yol haritasının tamamlandığı iddiası değildir.

## 1.9.0 - 2026-03-20

### Öne Çıkanlar

- Manifest tabanlı pipeline ve SQLite state store ile seçici kurulum mimarisi.
- 6 yeni ajan ve dile özgü kurallarla 10+ ekosisteme genişletilmiş dil kapsamı.
- Bellek azaltma, sandbox düzeltmeleri ve 5 katmanlı döngü koruması ile sağlamlaştırılmış Observer güvenilirliği.
- Beceri evrimi ve session adaptörleri ile kendini geliştiren beceriler temeli.

### Yeni Ajanlar

- `typescript-reviewer` — TypeScript/JavaScript kod inceleme uzmanı (#647)
- `pytorch-build-resolver` — PyTorch runtime, CUDA ve eğitim hatası çözümü (#549)
- `java-build-resolver` — Maven/Gradle build hatası çözümü (#538)
- `java-reviewer` — Java ve Spring Boot kod incelemesi (#528)
- `kotlin-reviewer` — Kotlin/Android/KMP kod incelemesi (#309)
- `kotlin-build-resolver` — Kotlin/Gradle build hataları (#309)
- `rust-reviewer` — Rust kod incelemesi (#523)
- `rust-build-resolver` — Rust build hatası çözümü (#523)
- `docs-lookup` — Dokümantasyon ve API referans araştırması (#529)

### Yeni Beceriler

- `pytorch-patterns` — PyTorch derin öğrenme iş akışları (#550)
- `documentation-lookup` — API referans ve kütüphane dokümanı araştırması (#529)
- `bun-runtime` — Bun runtime kalıpları (#529)
- `nextjs-turbopack` — Next.js Turbopack iş akışları (#529)
- `mcp-server-patterns` — MCP sunucu tasarım kalıpları (#531)
- `data-scraper-agent` — AI destekli genel veri toplama (#503)
- `team-builder` — Takım kompozisyon becerisi (#501)
- `ai-regression-testing` — AI regresyon test iş akışları (#433)
- `claude-devfleet` — Çok ajanlı orkestrasyon (#505)
- `blueprint` — Çok oturumlu yapı planlaması
- `everything-claude-code` — Öz-referansiyel ECC becerisi (#335)
- `prompt-optimizer` — Prompt optimizasyon becerisi (#418)
- 8 Evos operasyonel alan becerisi (#290)
- 3 Laravel becerisi (#420)
- VideoDB becerileri (#301)

### Yeni Komutlar

- `/docs` — Dokümantasyon arama (#530)
- `/aside` — Yan konuşma (#407)
- `/prompt-optimize` — Prompt optimizasyonu (#418)
- `/resume-session`, `/save-session` — Oturum yönetimi
- Kontrol listesi tabanlı holistik karar ile `learn-eval` iyileştirmeleri

### Yeni Kurallar

- Java dil kuralları (#645)
- PHP kural paketi (#389)
- Perl dil kuralları ve becerileri (kalıplar, güvenlik, test)
- Kotlin/Android/KMP kuralları (#309)
- C++ dil desteği (#539)
- Rust dil desteği (#523)

### Altyapı

- Manifest çözümlemesi ile seçici kurulum mimarisi (`install-plan.js`, `install-apply.js`) (#509, #512)
- Kurulu bileşenleri izlemek için sorgu CLI'si ile SQLite state store (#510)
- Yapılandırılmış oturum kaydı için session adaptörleri (#511)
- Kendini geliştiren beceriler için beceri evrimi temeli (#514)
- Deterministik puanlama ile orkestrasyon harness (#524)
- CI'da katalog sayısı kontrolü (#525)
- Tüm 109 beceri için install manifest doğrulaması (#537)
- PowerShell installer wrapper (#532)
- `--target antigravity` bayrağı ile Antigravity IDE desteği (#332)
- Codex CLI özelleştirme scriptleri (#336)

### Hata Düzeltmeleri

- 6 dosyada 19 CI test hatasının çözümü (#519)
- Install pipeline, orchestrator ve repair'da 8 test hatasının düzeltmesi (#564)
- Azaltma, yeniden giriş koruması ve tail örneklemesi ile Observer bellek patlaması (#536)
- Haiku çağrısı için Observer sandbox erişim düzeltmesi (#661)
- Worktree proje ID uyumsuzluğu düzeltmesi (#665)
- Observer lazy-start mantığı (#508)
- Observer 5 katmanlı döngü önleme koruması (#399)
- Hook taşınabilirliği ve Windows .cmd desteği
- Biome hook optimizasyonu — npx yükü elimine edildi (#359)
- InsAIts güvenlik hook'u opt-in yapıldı (#370)
- Windows spawnSync export düzeltmesi (#431)
- instinct CLI için UTF-8 kodlama düzeltmesi (#353)
- Hook'larda secret scrubbing (#348)

### Çeviriler

- Korece (ko-KR) çeviri — README, ajanlar, komutlar, beceriler, kurallar (#392)
- Çince (zh-CN) dokümantasyon senkronizasyonu (#428)

### Katkıda Bulunanlar

- @ymdvsymd — observer sandbox ve worktree düzeltmeleri
- @pythonstrup — biome hook optimizasyonu
- @Nomadu27 — InsAIts güvenlik hook'u
- @hahmee — Korece çeviri
- @zdocapp — Çince çeviri senkronizasyonu
- @cookiee339 — Kotlin ekosistemi
- @pangerlkr — CI iş akışı düzeltmeleri
- @0xrohitgarg — VideoDB becerileri
- @nocodemf — Evos operasyonel becerileri
- @swarnika-cmd — topluluk katkıları

## 1.8.0 - 2026-03-04

### Öne Çıkanlar

- Güvenilirlik, eval disiplini ve otonom döngü operasyonlarına odaklanan harness-first sürüm.
- Hook runtime artık profil tabanlı kontrol ve hedefli hook devre dışı bırakmayı destekliyor.
- NanoClaw v2, model yönlendirme, beceri hot-load, dallanma, arama, sıkıştırma, dışa aktarma ve metrikler ekliyor.

### Çekirdek

- Yeni komutlar eklendi: `/harness-audit`, `/loop-start`, `/loop-status`, `/quality-gate`, `/model-route`.
- Yeni beceriler eklendi:
  - `agent-harness-construction`
  - `agentic-engineering`
  - `ralphinho-rfc-pipeline`
  - `ai-first-engineering`
  - `enterprise-agent-ops`
  - `nanoclaw-repl`
  - `continuous-agent-loop`
- Yeni ajanlar eklendi:
  - `harness-optimizer`
  - `loop-operator`

### Hook Güvenilirliği

- Sağlam yedek arama ile SessionStart root çözümlemesi düzeltildi.
- Oturum özet kalıcılığı, transcript payload'ın mevcut olduğu `Stop`'a taşındı.
- Quality-gate ve cost-tracker hook'ları eklendi.
- Kırılgan inline hook tek satırlıkları özel script dosyalarıyla değiştirildi.
- `ECC_HOOK_PROFILE` ve `ECC_DISABLED_HOOKS` kontrolleri eklendi.

### Platformlar Arası

- Doküman uyarı mantığında Windows-safe yol işleme iyileştirildi.
- Etkileşimsiz takılmaları önlemek için Observer döngü davranışı sağlamlaştırıldı.

### Notlar

- `autonomous-loops`, bir sürüm için uyumluluk takma adı olarak tutuldu; `continuous-agent-loop` kanonik isimdir.

### Katkıda Bulunanlar

- [zarazhangrui](https://github.com/zarazhangrui) tarafından ilham alındı
- [humanplane](https://github.com/humanplane) tarafından homunculus-ilhamlı
