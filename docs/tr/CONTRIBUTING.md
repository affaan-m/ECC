# ECC'ye Katkıda Bulunma

Katkıda bulunmak istediğiniz için teşekkürler! Bu repo, Claude Code kullanıcıları için bir topluluk kaynağıdır.

## İçindekiler

- [Ne Arıyoruz](#ne-arıyoruz)
- [Hızlı Başlangıç](#hızlı-başlangıç)
- [Skill'lere Katkıda Bulunma](#skilllere-katkıda-bulunma)
- [Agent'lara Katkıda Bulunma](#agentlara-katkıda-bulunma)
- [Hook'lara Katkıda Bulunma](#hooklara-katkıda-bulunma)
- [Command'lara Katkıda Bulunma](#commandlara-katkıda-bulunma)
- [MCP ve dokümantasyon (örn. Context7)](#mcp-ve-dokümantasyon-örn-context7)
- [Cross-Harness ve Çeviriler](#cross-harness-ve-çeviriler)
- [Pull Request Süreci](#pull-request-süreci)

---

## Ne Arıyoruz

### Agent'lar
Belirli görevleri iyi yöneten yeni agent'lar:
- Dile özgü reviewer'lar (Python, Go, Rust)
- Framework uzmanları (Django, Rails, Laravel, Spring)
- DevOps uzmanları (Kubernetes, Terraform, CI/CD)
- Alan uzmanları (ML pipeline'ları, data engineering, mobil)

### Skill'ler
Workflow tanımları ve alan bilgisi:
- Dil en iyi uygulamaları
- Framework pattern'leri
- Test stratejileri
- Mimari kılavuzları

### Hook'lar
Faydalı otomasyonlar:
- Linting/formatlama hook'ları
- Güvenlik kontrolleri
- Doğrulama hook'ları
- Bildirim hook'ları

### Command'lar
Faydalı workflow'ları çağıran slash command'lar:
- Deployment command'ları
- Test command'ları
- Kod üretim command'ları

---

## Hızlı Başlangıç

```bash
# 1. Fork ve clone
gh repo fork affaan-m/ECC --clone
cd ECC

# 2. Branch oluştur
git checkout -b feat/my-contribution

# 3. Katkınızı ekleyin (aşağıdaki bölümlere bakın)

# 4. Yerel olarak test edin
cp -r skills/my-skill ~/.claude/skills/  # skill'ler için
# Ardından Claude Code ile test edin

# 5. PR gönderin
git add . && git commit -m "feat: add my-skill" && git push -u origin feat/my-contribution
```

---

## Skill'lere Katkıda Bulunma

Skill'ler, Claude Code'un bağlama göre yüklediği bilgi modülleridir.

### Dizin Yapısı

```
skills/
└── your-skill-name/
    └── SKILL.md
```

### SKILL.md Şablonu

```markdown
---
name: your-skill-name
description: Skill listesinde gösterilen kısa açıklama
origin: ECC
---

# Skill Başlığınız

Bu skill'in neyi kapsadığına dair kısa genel bakış.

## Temel Kavramlar

Temel pattern'leri ve yönergeleri açıklayın.

## Kod Örnekleri

\`\`\`typescript
// Pratik, test edilmiş örnekler ekleyin
function example() {
  // İyi yorumlanmış kod
}
\`\`\`

## En İyi Uygulamalar

- Uygulanabilir yönergeler
- Yapılması ve yapılmaması gerekenler
- Kaçınılması gereken yaygın hatalar

## Ne Zaman Kullanılır

Bu skill'in uygulandığı senaryoları açıklayın.
```

### Skill Kontrol Listesi

- [ ] Tek bir alan/teknolojiye odaklanmış
- [ ] Pratik kod örnekleri içeriyor
- [ ] 500 satırın altında
- [ ] Net bölüm başlıkları kullanıyor
- [ ] Claude Code ile test edilmiş

### Örnek Skill'ler

| Skill | Amaç |
|-------|---------|
| `coding-standards/` | TypeScript/JavaScript pattern'leri |
| `frontend-patterns/` | React ve Next.js en iyi uygulamaları |
| `backend-patterns/` | API ve veritabanı pattern'leri |
| `security-review/` | Güvenlik kontrol listesi |

---

## Agent'lara Katkıda Bulunma

Agent'lar, Task tool üzerinden çağrılan özelleşmiş asistanlardır.

### Dosya Konumu

```
agents/your-agent-name.md
```

### Agent Şablonu

```markdown
---
name: your-agent-name
description: Bu agent'ın ne yaptığı ve Claude'un onu ne zaman çağırması gerektiği. Spesifik olun!
tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]
model: sonnet
---

Siz bir [rol] uzmanısınız.

## Rolünüz

- Birincil sorumluluk
- İkincil sorumluluk
- YAPMADIĞINIZ şeyler (sınırlar)

## Workflow

### Adım 1: Anlama
Göreve nasıl yaklaşıyorsunuz.

### Adım 2: Uygulama
İşi nasıl gerçekleştiriyorsunuz.

### Adım 3: Doğrulama
Sonuçları nasıl doğruluyorsunuz.

## Çıktı Formatı

Kullanıcıya ne döndürüyorsunuz.

## Örnekler

### Örnek: [Senaryo]
Girdi: [kullanıcının sağladığı]
Eylem: [yaptığınız]
Çıktı: [döndürdüğünüz]
```

### Agent Alanları

| Alan | Açıklama | Seçenekler |
|-------|-------------|---------|
| `name` | Küçük harf, tire ile ayrılmış | `code-reviewer` |
| `description` | Ne zaman çağrılacağına karar vermek için kullanılır | Spesifik olun! |
| `tools` | Sadece gerekli olanlar | `Read, Write, Edit, Bash, Grep, Glob, WebFetch, Task`, veya agent MCP kullanıyorsa MCP tool isimleri (örn. `mcp__context7__resolve-library-id`, `mcp__context7__query-docs`) |
| `model` | Karmaşıklık seviyesi | `haiku` (basit), `sonnet` (kodlama), `opus` (karmaşık) |

### Örnek Agent'lar

| Agent | Amaç |
|-------|---------|
| `tdd-guide.md` | Test odaklı geliştirme |
| `code-reviewer.md` | Kod incelemesi |
| `security-reviewer.md` | Güvenlik taraması |
| `build-error-resolver.md` | Build hatalarını düzeltme |

---

## Hook'lara Katkıda Bulunma

Hook'lar, Claude Code olayları tarafından tetiklenen otomatik davranışlardır.

### Dosya Konumu

```
hooks/hooks.json
```

### Hook Türleri

| Tür | Tetikleyici | Kullanım Alanı |
|------|---------|----------|
| `PreToolUse` | Tool çalışmadan önce | Doğrulama, uyarı, engelleme |
| `PostToolUse` | Tool çalıştıktan sonra | Formatlama, kontrol, bildirim |
| `SessionStart` | Oturum başladığında | Bağlam yükleme |
| `Stop` | Oturum sona erdiğinde | Temizleme, denetim |

### Hook Formatı

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "tool == \"Bash\" && tool_input.command matches \"rm -rf /\"",
        "hooks": [
          {
            "type": "command",
            "command": "echo '[Hook] ENGELLENDİ: Tehlikeli komut' && exit 1"
          }
        ],
        "description": "Tehlikeli rm komutlarını engelle"
      }
    ]
  }
}
```

### Matcher Sözdizimi

```javascript
// Belirli tool'ları eşleştir
tool == "Bash"
tool == "Edit"
tool == "Write"

// Girdi pattern'lerini eşleştir
tool_input.command matches "npm install"
tool_input.file_path matches "\\.tsx?$"

// Koşulları birleştir
tool == "Bash" && tool_input.command matches "git push"
```

### Hook Örnekleri

```json
// tmux dışında dev server'ları engelle
{
  "matcher": "tool == \"Bash\" && tool_input.command matches \"npm run dev\"",
  "hooks": [{"type": "command", "command": "echo 'Dev server'lar için tmux kullanın' && exit 1"}],
  "description": "Dev server'ların tmux'ta çalışmasını sağla"
}

// TypeScript düzenledikten sonra otomatik formatla
{
  "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\.tsx?$\"",
  "hooks": [{"type": "command", "command": "npx prettier --write \"$file_path\""}],
  "description": "TypeScript dosyalarını düzenlemeden sonra formatla"
}

// git push öncesi uyar
{
  "matcher": "tool == \"Bash\" && tool_input.command matches \"git push\"",
  "hooks": [{"type": "command", "command": "echo '[Hook] Push yapmadan önce değişiklikleri gözden geçirin'"}],
  "description": "Push öncesi gözden geçirme hatırlatıcısı"
}
```

### Hook Kontrol Listesi

- [ ] Matcher spesifik (aşırı geniş değil)
- [ ] Net hata/bilgi mesajları içeriyor
- [ ] Doğru çıkış kodlarını kullanıyor (`exit 1` engeller, `exit 0` izin verir)
- [ ] Kapsamlı test edilmiş
- [ ] Açıklama içeriyor

---

## Command'lara Katkıda Bulunma

Command'lar, `/command-name` ile kullanıcı tarafından çağrılan eylemlerdir.

### Dosya Konumu

```
commands/your-command.md
```

### Command Şablonu

```markdown
---
description: /help'te gösterilen kısa açıklama
---

# Command Adı

## Amaç

Bu command'ın ne yaptığı.

## Kullanım

\`\`\`
/your-command [args]
\`\`\`

## Workflow

1. İlk adım
2. İkinci adım
3. Son adım

## Çıktı

Kullanıcının aldığı.
```

### Örnek Command'lar

| Command | Amaç |
|---------|---------|
| `commit.md` | Git commit'leri oluştur |
| `code-review.md` | Kod değişikliklerini incele |
| `tdd.md` | TDD workflow'u |
| `e2e.md` | E2E test |

---

## MCP ve dokümantasyon (örn. Context7)

Skill'ler ve agent'lar, sadece eğitim verilerine güvenmek yerine güncel verileri çekmek için **MCP (Model Context Protocol)** tool'larını kullanabilir. Bu özellikle dokümantasyon için faydalıdır.

- **Context7**, `resolve-library-id` ve `query-docs`'u açığa çıkaran bir MCP server'ıdır. Kullanıcı kütüphaneler, framework'ler veya API'ler hakkında sorduğunda, cevapların güncel dokümantasyonu ve kod örneklerini yansıtması için kullanın.
- Canlı dokümantasyona bağlı **skill'lere** katkıda bulunurken (örn. kurulum, API kullanımı), ilgili MCP tool'larının nasıl kullanılacağını açıklayın (örn. kütüphane ID'sini çözümle, ardından dokümantasyonu sorgula) ve pattern olarak `documentation-lookup` skill'ine veya Context7'ye işaret edin.
- Dokümantasyon/API sorularını yanıtlayan **agent'lara** katkıda bulunurken, agent'ın tool'larına Context7 MCP tool isimlerini ekleyin (örn. `mcp__context7__resolve-library-id`, `mcp__context7__query-docs`) ve çözümle → sorgula workflow'unu belgeleyin.
- **mcp-configs/mcp-servers.json** bir Context7 girişi içerir; kullanıcılar `documentation-lookup` skill'ini (`skills/documentation-lookup/` içinde) ve `/docs` command'ını kullanmak için bunu harness'lerinde (örn. Claude Code, Cursor) etkinleştirir.

---

## Cross-Harness ve Çeviriler

### Skill alt kümeleri (Codex ve Cursor)

ECC, diğer harness'ler için skill alt kümeleri içerir:

- **Codex:** `.agents/skills/` — `agents/openai.yaml` içinde listelenen skill'ler Codex tarafından yüklenir.
- **Cursor:** `.cursor/skills/` — Cursor için bir skill alt kümesi paketlenmiştir.

Codex veya Cursor'da kullanılabilir olması gereken **yeni bir skill eklediğinizde**:

1. Skill'i her zamanki gibi `skills/your-skill-name/` altına ekleyin.
2. **Codex**'te kullanılabilir olması gerekiyorsa, `.agents/skills/` altına ekleyin (skill dizinini kopyalayın veya referans ekleyin) ve gerekirse `agents/openai.yaml` içinde referans verildiğinden emin olun.
3. **Cursor**'da kullanılabilir olması gerekiyorsa, Cursor'un düzenine göre `.cursor/skills/` altına ekleyin.

Beklenen yapı için bu dizinlerdeki mevcut skill'leri kontrol edin. Bu alt kümeleri senkronize tutmak manuel bir işlemdir; bunları güncellediyseniz PR'ınızda belirtin.

### Çeviriler

Çeviriler `docs/` altında bulunur (örn. `docs/zh-CN`, `docs/zh-TW`, `docs/ja-JP`). Çevrilmiş agent'ları, command'ları veya skill'leri değiştirirseniz, ilgili çeviri dosyalarını güncellemeyi veya bakımcıların ya da çevirmenlerin bunları güncelleyebilmesi için bir issue açmayı düşünün.

---

## Pull Request Süreci

### 1. PR Başlık Formatı

```
feat(skills): add rust-patterns skill
feat(agents): add api-designer agent
feat(hooks): add auto-format hook
fix(skills): update React patterns
docs: improve contributing guide
```

### 2. PR Açıklaması

```markdown
## Özet
Ne eklediğiniz ve neden.

## Tür
- [ ] Skill
- [ ] Agent
- [ ] Hook
- [ ] Command

## Test
Bunu nasıl test ettiniz.

## Kontrol Listesi
- [ ] Format yönergelerini takip ediyor
- [ ] Claude Code ile test edildi
- [ ] Hassas bilgi yok (API anahtarları, yollar)
- [ ] Net açıklamalar
```

### 3. İnceleme Süreci

1. Bakımcılar 48 saat içinde inceler
2. İstenirse geri bildirimlere cevap verin
3. Onaylandığında, main'e merge edilir

---

## Yönergeler

### Yapın
- Katkıları odaklanmış ve modüler tutun
- Net açıklamalar ekleyin
- Göndermeden önce test edin
- Mevcut pattern'leri takip edin
- Bağımlılıkları belgeleyin

### Yapmayın
- Hassas veri eklemeyin (API anahtarları, token'lar, yollar)
- Aşırı karmaşık veya niş config'ler eklemeyin
- Test edilmemiş katkılar göndermeyin
- Mevcut işlevselliğin kopyalarını oluşturmayın

---

## Dosya Adlandırma

- Tire ile küçük harf kullanın: `python-reviewer.md`
- Açıklayıcı olun: `tdd-workflow.md` değil `workflow.md`
- İsim, dosya adıyla eşleşsin

---

## Sorularınız mı var?

- **Issue'lar:** [github.com/affaan-m/ECC/issues](https://github.com/affaan-m/ECC/issues)
- **X/Twitter:** [@affaanmustafa](https://x.com/affaanmustafa)

---

Katkıda bulunduğunuz için teşekkürler! Birlikte harika bir kaynak oluşturalım.
