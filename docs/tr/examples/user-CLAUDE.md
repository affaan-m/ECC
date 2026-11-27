# Kullanıcı Seviyesi CLAUDE.md Örneği

Bu, örnek bir kullanıcı seviyesi CLAUDE.md dosyasıdır. `~/.claude/CLAUDE.md` konumuna yerleştirin.

Kullanıcı seviyesi konfigürasyonlar tüm projeler genelinde global olarak uygulanır. Şunlar için kullanın:
- Kişisel kodlama tercihleri
- Her zaman uygulanmasını istediğiniz evrensel kurallar
- Modüler kurallarınıza linkler

---

## Temel Felsefe

Sen Claude Code'sun. Karmaşık görevler için özelleşmiş agent'lar ve skill'ler kullanıyorum.

**Temel Prensipler:**
1. **Agent-First**: Karmaşık işler için özelleşmiş agent'lara delege et
2. **Paralel Yürütme**: Mümkün olduğunda Task tool ile birden fazla agent kullan
3. **Planlayıp Uygula**: Karmaşık operasyonlar için Plan Mode kullan
4. **Test-Driven**: Uygulamadan önce testleri yaz
5. **Security-First**: Güvenlikten asla taviz verme

---

## Modüler Kurallar

Detaylı yönergeler `~/.claude/rules/` içinde:

| Kural Dosyası | İçerik |
|---------------|--------|
| security.md | Güvenlik kontrolleri, secret yönetimi |
| coding-style.md | Değişmezlik, dosya organizasyonu, hata yönetimi |
| testing.md | TDD iş akışı, %80 kapsama gereksinimi |
| git-workflow.md | Commit formatı, PR iş akışı |
| agents.md | Agent orkestrayonu, hangi agent'ın ne zaman kullanılacağı |
| patterns.md | API response, repository desenleri |
| performance.md | Model seçimi, context yönetimi |
| hooks.md | Hooks Sistemi |

---

## Kullanılabilir Agent'lar

`~/.claude/agents/` konumunda bulunur:

| Agent | Amaç |
|-------|------|
| planner | Özellik uygulama planlaması |
| architect | Sistem tasarımı ve mimari |
| tdd-guide | Test-driven development |
| code-reviewer | Kalite/güvenlik için kod incelemesi |
| security-reviewer | Güvenlik açığı analizi |
| build-error-resolver | Build hatası çözümü |
| e2e-runner | Playwright E2E testi |
| refactor-cleaner | Ölü kod temizliği |
| doc-updater | Dokümantasyon güncellemeleri |

---

## Kişisel Tercihler

### Gizlilik
- Logları her zaman redact et; asla secret'ları yapıştırma (API key'ler/token'lar/şifreler/JWT'ler)
- Paylaşmadan önce çıktıyı gözden geçir - hassas verileri kaldır

### Kod Stili
- Kod, yorum veya dokümantasyonda emoji kullanma
- Değişmezliği tercih et - asla obje veya array'leri mutate etme
- Birkaç büyük dosya yerine çok sayıda küçük dosya
- Tipik olarak 200-400 satır, dosya başına maksimum 800 satır

### Git
- Conventional commit'ler: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- Commit'lemeden önce her zaman yerel olarak test et
- Küçük, odaklanmış commit'ler

### Test
- TDD: Önce testleri yaz
- Minimum %80 kapsama
- Kritik akışlar için unit + integration + E2E

### Bilgi Yakalama
- Kişisel debugging notları, tercihler ve geçici bağlam → otomatik bellek
- Ekip/proje bilgisi (mimari kararlar, API değişiklikleri, uygulama runbook'ları) → projenin mevcut doküman yapısını takip et
- Mevcut görev zaten ilgili dokümanları, yorumları veya örnekleri üretiyorsa, aynı bilgiyi başka yerde çoğaltma
- Açık bir proje doküman konumu yoksa, yeni bir üst seviye doküman oluşturmadan önce sor

---

## Editor Entegrasyonu

Birincil editör olarak Zed kullanıyorum:
- Dosya takibi için Agent Panel
- Komut paleti için CMD+Shift+R
- Vim modu aktif

---

## Başarı Metrikleri

Şu durumlarda başarılısın:
- Tüm testler geçiyor (%80+ kapsama)
- Güvenlik açığı yok
- Kod okunabilir ve sürdürülebilir
- Kullanıcı gereksinimleri karşılanıyor

---

**Felsefe**: Agent-first tasarım, paralel yürütme, eylemden önce plan, koddan önce test, her zaman güvenlik.
