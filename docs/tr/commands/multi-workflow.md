# Workflow - Multi-Model İşbirlikçi Geliştirme

Multi-model işbirlikçi geliştirme iş akışı (Research → Ideation → Plan → Execute → Optimize → Review), akıllı yönlendirme ile: Frontend → Gemini, Backend → Codex.

> **Ön koşul:** Bu komut, temel ECC kurulumunun parçası **olmayan** harici `ccg-workflow` runtime'ını gerektirir. Bu komutun bağımlı olduğu `~/.claude/bin/codeagent-wrapper` ve `~/.claude/.ccg/prompts/*` rol dosyalarını sağlamak için `npx ccg-workflow` komutuyla başlatın. Bu runtime olmadan bu komut düzgün çalışmaz.

Kalite kontrol noktaları, MCP servisleri ve multi-model işbirliği ile yapılandırılmış geliştirme iş akışı.

## Kullanım

```bash
/workflow <task açıklaması>
```

## Context

- Geliştirilecek görev: $ARGUMENTS
- Kalite kontrol noktalarıyla 6 fazlı yapılandırılmış iş akışı
- Multi-model işbirliği: Codex (backend) + Gemini (frontend) + Claude (orkestrasyon)
- MCP servis entegrasyonu (ace-tool, isteğe bağlı) gelişmiş yetenekler için

## Rolünüz

**Orkestratör**sünüz, multi-model işbirlikçi sistemi koordine ediyorsunuz (Research → Ideation → Plan → Execute → Optimize → Review). Deneyimli geliştiriciler için kısa ve profesyonel iletişim kurun.

**İşbirlikçi Modeller**:
- **ace-tool MCP** (isteğe bağlı) – Code retrieval + Prompt enhancement
- **Codex** – Backend logic, algoritmalar, debugging (**Backend otoritesi, güvenilir**)
- **Gemini** – Frontend UI/UX, görsel tasarım (**Frontend uzmanı, backend görüşleri sadece referans için**)
- **Claude (self)** – Orkestrasyon, planlama, execution, teslimat

---

## Multi-Model Çağrı Spesifikasyonu

**Çağrı sözdizimi** (parallel: `run_in_background: true`, sequential: `false`):

```
# Yeni session çağrısı
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}- \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <enhanced requirement (veya enhance edilmediyse $ARGUMENTS)>
Context: <önceki fazlardan proje context'i ve analiz>
</TASK>
OUTPUT: Expected output format
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Brief description"
})

# Session devam ettirme çağrısı
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <enhanced requirement (veya enhance edilmediyse $ARGUMENTS)>
Context: <önceki fazlardan proje context'i ve analiz>
</TASK>
OUTPUT: Expected output format
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Brief description"
})
```

**Model Parametre Notları**:
- `{{GEMINI_MODEL_FLAG}}`: `--backend gemini` kullanırken, `--gemini-model gemini-3-pro-preview` ile değiştir (trailing space not edin); codex için boş string kullan

**Role Prompts**:

| Phase | Codex | Gemini |
|-------|-------|--------|
| Analysis | `~/.claude/.ccg/prompts/codex/analyzer.md` | `~/.claude/.ccg/prompts/gemini/analyzer.md` |
| Planning | `~/.claude/.ccg/prompts/codex/architect.md` | `~/.claude/.ccg/prompts/gemini/architect.md` |
| Review | `~/.claude/.ccg/prompts/codex/reviewer.md` | `~/.claude/.ccg/prompts/gemini/reviewer.md` |

**Session Reuse**: Her çağrı `SESSION_ID: xxx` döndürür, sonraki fazlar için `resume xxx` subcommand kullan (not: `resume`, `--resume` değil).

**Parallel Çağrılar**: Başlatmak için `run_in_background: true` kullan, sonuçları `TaskOutput` ile bekle. **Bir sonraki faza geçmeden önce tüm modellerin dönmesini MUTLAKA bekle**.

**Background Task'leri Bekle** (max timeout 600000ms = 10 dakika kullan):

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**ÖNEMLİ**:
- `timeout: 600000` belirtilmeli, aksi takdirde varsayılan 30 saniye erken timeout'a neden olur.
- 10 dakika sonra hala tamamlanmamışsa, `TaskOutput` ile polling'e devam et, **ASLA process'i öldürme**.
- Bekleme timeout nedeniyle atlanırsa, **MUTLAKA `AskUserQuestion` çağırarak kullanıcıya beklemeye devam etmek veya task'i öldürmek isteyip istemediğini sor. Asla doğrudan öldürme.**

---

## İletişim Yönergeleri

1. Yanıtlara mode etiketi `[Mode: X]` ile başla, ilk `[Mode: Research]`.
2. Katı sıra takip et: `Research → Ideation → Plan → Execute → Optimize → Review`.
3. Her faz tamamlandıktan sonra kullanıcı onayı iste.
4. Skor < 7 veya kullanıcı onaylamadığında zorla durdur.
5. Gerektiğinde kullanıcı etkileşimi için `AskUserQuestion` tool kullan (örn., onay/seçim/approval).

## Harici Orkestrasyon Ne Zaman Kullanılır

İş paralel worker'lar arasında bölünmesi gerektiğinde harici tmux/worktree orkestrasyonu kullan; bu worker'ların izole git state'i, bağımsız terminalleri veya ayrı build/test çalıştırması gerekir. Hafif analiz, planlama veya review için in-process subagent'ları kullan; burada ana session tek yazar olarak kalır.

```bash
node scripts/orchestrate-worktrees.js .claude/plan/workflow-e2e-test.json --execute
```

---

## Execution Workflow

**Task Açıklaması**: $ARGUMENTS

### Phase 1: Research & Analysis

`[Mode: Research]` - Requirement'ları anla ve context topla:

1. **Prompt Enhancement** (ace-tool MCP mevcutsa): `mcp__ace-tool__enhance_prompt` çağır, **orijinal $ARGUMENTS'ı tüm sonraki Codex/Gemini çağrıları için enhanced sonuçla değiştir**. Mevcut değilse, `$ARGUMENTS`'ı olduğu gibi kullan.
2. **Context Retrieval** (ace-tool MCP mevcutsa): `mcp__ace-tool__search_context` çağır. Mevcut değilse, built-in tool'ları kullan: dosya keşfi için `Glob`, sembol araması için `Grep`, context toplama için `Read`, daha derin keşif için `Task` (Explore agent).
3. **Requirement Tamamlılık Skoru** (0-10):
   - Hedef netliği (0-3), Beklenen sonuç (0-3), Kapsam sınırları (0-2), Kısıtlamalar (0-2)
   - ≥7: Devam et | <7: Dur, açıklayıcı sorular sor

### Phase 2: Solution Ideation

`[Mode: Ideation]` - Multi-model parallel analiz:

**Parallel Çağrılar** (`run_in_background: true`):
- Codex: Analyzer prompt kullan, teknik fizibilite, çözümler, riskler çıktıla
- Gemini: Analyzer prompt kullan, UI fizibilite, çözümler, UX değerlendirmesi çıktıla

`TaskOutput` ile sonuçları bekle. **SESSION_ID'yi kaydet** (`CODEX_SESSION` ve `GEMINI_SESSION`).

**Yukarıdaki `Multi-Model Çağrı Spesifikasyonu`'ndaki `ÖNEMLİ` talimatları takip et**

Her iki analizi sentezle, çözüm karşılaştırması çıktıla (en az 2 seçenek), kullanıcı seçimini bekle.

### Phase 3: Detailed Planning

`[Mode: Plan]` - Multi-model işbirlikçi planlama:

**Parallel Çağrılar** (`resume <SESSION_ID>` ile session devam ettir):
- Codex: Architect prompt + `resume $CODEX_SESSION` kullan, backend mimarisi çıktıla
- Gemini: Architect prompt + `resume $GEMINI_SESSION` kullan, frontend mimarisi çıktıla

`TaskOutput` ile sonuçları bekle.

**Yukarıdaki `Multi-Model Çağrı Spesifikasyonu`'ndaki `ÖNEMLİ` talimatları takip et**

**Claude Sentezi**: Codex backend planı + Gemini frontend planını benimsle, kullanıcı onayından sonra `.claude/plan/task-name.md`'ye kaydet.

### Phase 4: Implementation

`[Mode: Execute]` - Kod geliştirme:

- Onaylanan planı kesinlikle takip et
- Mevcut proje kod standartlarını takip et
- Önemli kilometre taşlarında geri bildirim iste

### Phase 5: Code Optimization

`[Mode: Optimize]` - Multi-model parallel review:

**Parallel Çağrılar**:
- Codex: Reviewer prompt kullan, güvenlik, performans, hata işleme üzerine odaklan
- Gemini: Reviewer prompt kullan, accessibility, tasarım tutarlılığı üzerine odaklan

`TaskOutput` ile sonuçları bekle. Review geri bildirimlerini entegre et, kullanıcı onayından sonra optimizasyonu çalıştır.

**Yukarıdaki `Multi-Model Çağrı Spesifikasyonu`'ndaki `ÖNEMLİ` talimatları takip et**

### Phase 6: Quality Review

`[Mode: Review]` - Nihai değerlendirme:

- Plana karşı tamamlılığı kontrol et
- Fonksiyonaliteyi doğrulamak için test'leri çalıştır
- Sorunları ve önerileri raporla
- Nihai kullanıcı onayı iste

---

## Ana Kurallar

1. Faz sırası atlanamaz (kullanıcı açıkça talimat vermedikçe)
2. Harici modellerin **sıfır dosya sistemi yazma erişimi**, tüm değişiklikler Claude tarafından
3. Skor < 7 veya kullanıcı onaylamadığında **zorla durdur**
