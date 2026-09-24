# Plan - Multi-Model İşbirlikçi Planlama

Multi-model işbirlikçi planlama - Context retrieval + Dual-model analiz → Adım adım implementation planı oluştur.

> **Ön koşul:** Bu komut, temel ECC kurulumunun parçası **olmayan** harici `ccg-workflow` runtime'ını gerektirir. Bu komutun bağımlı olduğu `~/.claude/bin/codeagent-wrapper` ve `~/.claude/.ccg/prompts/*` rol dosyalarını sağlamak için `npx ccg-workflow` komutuyla başlatın. Bu runtime olmadan bu komut düzgün çalışmaz.

$ARGUMENTS

---

## Ana Protokoller

- **Dil Protokolü**: Tool/model'lerle etkileşimde **İngilizce** kullan, kullanıcıyla kendi dilinde iletişim kur
- **Zorunlu Parallel**: Codex/Gemini çağrıları `run_in_background: true` kullanmalı (ana thread'i bloke etmemek için tek model çağrılarında bile)
- **Kod Egemenliği**: Harici modellerin **sıfır dosya sistemi yazma erişimi**, tüm değişiklikler Claude tarafından
- **Stop-Loss Mekanizması**: Mevcut faz çıktısı doğrulanana kadar bir sonraki faza geçme
- **Sadece Planlama**: Bu komut context okumaya ve `.claude/plan/*` plan dosyalarına yazmaya izin verir, ancak **ASLA production kodu değiştirmez**

---

## Multi-Model Çağrı Spesifikasyonu

**Çağrı Sözdizimi** (parallel: `run_in_background: true` kullan):

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}- \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <enhanced requirement>
Context: <retrieved project context>
</TASK>
OUTPUT: Step-by-step implementation plan with pseudo-code. DO NOT modify any files.
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

**Session Reuse**: Her çağrı `SESSION_ID: xxx` döndürür (genellikle wrapper tarafından çıktılanır), sonraki `/ccg:execute` kullanımı için **MUTLAKA kaydet**.

**Background Task'leri Bekle** (max timeout 600000ms = 10 dakika):

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**ÖNEMLİ**:
- `timeout: 600000` belirtilmeli, aksi takdirde varsayılan 30 saniye erken timeout'a neden olur
- 10 dakika sonra hala tamamlanmamışsa, `TaskOutput` ile polling'e devam et, **ASLA process'i öldürme**
- Bekleme timeout nedeniyle atlanırsa, **MUTLAKA `AskUserQuestion` çağırarak kullanıcıya beklemeye devam etmek veya task'i öldürmek isteyip istemediğini sor**

---

## Execution Workflow

**Planlama Görevi**: $ARGUMENTS

### Phase 1: Tam Context Retrieval

`[Mode: Research]`

#### 1.1 Prompt Enhancement (İLK önce çalıştırılmalı)

**ace-tool MCP mevcutsa**, `mcp__ace-tool__enhance_prompt` tool'unu çağır:

```
mcp__ace-tool__enhance_prompt({
  prompt: "$ARGUMENTS",
  conversation_history: "<son 5-10 konuşma turu>",
  project_root_path: "$PWD"
})
```

Enhanced prompt'u bekle, **orijinal $ARGUMENTS'ı tüm sonraki fazlar için enhanced sonuçla değiştir**.

**ace-tool MCP mevcut DEĞİLSE**: Bu adımı atla ve tüm sonraki fazlar için orijinal `$ARGUMENTS`'ı olduğu gibi kullan.

#### 1.2 Context Retrieval

**ace-tool MCP mevcutsa**, `mcp__ace-tool__search_context` tool'unu çağır:

```
mcp__ace-tool__search_context({
  query: "<enhanced requirement'a dayalı semantik sorgu>",
  project_root_path: "$PWD"
})
```

- Doğal dil kullanarak semantik sorgu oluştur (Where/What/How)
- **ASLA varsayımlara dayalı cevap verme**

**ace-tool MCP mevcut DEĞİLSE**, fallback olarak Claude Code built-in tool'ları kullan:
1. **Glob**: Pattern'e göre ilgili dosyaları bul (örn., `Glob("**/*.ts")`, `Glob("src/**/*.py")`)
2. **Grep**: Anahtar semboller, fonksiyon adları, sınıf tanımlarını ara (örn., `Grep("className|functionName")`)
3. **Read**: Tam context toplamak için keşfedilen dosyaları oku
4. **Task (Explore agent)**: Daha derin keşif için, codebase genelinde aramak üzere `Task`'ı `subagent_type: "Explore"` ile kullan

#### 1.3 Tamamlılık Kontrolü

- İlgili sınıflar, fonksiyonlar, değişkenler için **tam tanımlar ve imzalar** elde etmeli
- Context yetersizse, **recursive retrieval** tetikle
- Çıktıya öncelik ver: giriş dosyası + satır numarası + anahtar sembol adı; belirsizliği çözmek için gerekli olduğunda minimal kod snippet'leri ekle

#### 1.4 Requirement Alignment

- Requirement'larda hala belirsizlik varsa, kullanıcı için yönlendirici sorular **MUTLAKA** çıktıla
- Requirement sınırları net olana kadar (eksiklik yok, fazlalık yok)

### Phase 2: Multi-Model İşbirlikçi Analiz

`[Mode: Analysis]`

#### 2.1 Input'ları Dağıt

**Parallel call** Codex ve Gemini (`run_in_background: true`):

**Orijinal requirement**'ı (önceden belirlenmiş görüşler olmadan) her iki modele dağıt:

1. **Codex Backend Analysis**:
   - ROLE_FILE: `~/.claude/.ccg/prompts/codex/analyzer.md`
   - Odak: Teknik fizibilite, mimari etki, performans değerlendirmeleri, potansiyel riskler
   - OUTPUT: Çok perspektifli çözümler + artı/eksi analizi

2. **Gemini Frontend Analysis**:
   - ROLE_FILE: `~/.claude/.ccg/prompts/gemini/analyzer.md`
   - Odak: UI/UX etkisi, kullanıcı deneyimi, görsel tasarım
   - OUTPUT: Çok perspektifli çözümler + artı/eksi analizi

`TaskOutput` ile her iki modelin tam sonuçlarını bekle. **SESSION_ID'yi kaydet** (`CODEX_SESSION` ve `GEMINI_SESSION`).

#### 2.2 Cross-Validation

Perspektifleri entegre et ve optimizasyon için iterate et:

1. **Consensus tanımla** (güçlü sinyal)
2. **Divergence tanımla** (değerlendirme gerektirir)
3. **Tamamlayıcı güçlü yönler**: Backend logic Codex'i takip eder, Frontend design Gemini'yi takip eder
4. **Mantıksal akıl yürütme**: Çözümlerdeki mantıksal boşlukları elimine et

#### 2.3 (İsteğe Bağlı ama Önerilen) Dual-Model Plan Taslağı

Claude'un sentezlenmiş planındaki eksiklik riskini azaltmak için, her iki modelin de "plan taslakları" çıktılamasını parallel yaptır (yine **dosya değiştirmesine izin verilmez**):

1. **Codex Plan Draft** (Backend otoritesi):
   - ROLE_FILE: `~/.claude/.ccg/prompts/codex/architect.md`
   - OUTPUT: Adım adım plan + pseudo-code (odak: data flow/edge cases/error handling/test strategy)

2. **Gemini Plan Draft** (Frontend otoritesi):
   - ROLE_FILE: `~/.claude/.ccg/prompts/gemini/architect.md`
   - OUTPUT: Adım adım plan + pseudo-code (odak: information architecture/interaction/accessibility/visual consistency)

`TaskOutput` ile her iki modelin tam sonuçlarını bekle, önerilerindeki anahtar farkları kaydet.

#### 2.4 Implementation Planı Oluştur (Claude Final Version)

Her iki analizi sentezle, **Adım Adım Implementation Planı** oluştur:

```markdown
## Implementation Plan: <Task Name>

### Task Type
- [ ] Frontend (→ Gemini)
- [ ] Backend (→ Codex)
- [ ] Fullstack (→ Parallel)

### Technical Solution
<Codex + Gemini analizinden sentezlenmiş optimal çözüm>

### Implementation Steps
1. <Step 1> - Beklenen teslim edilen
2. <Step 2> - Beklenen teslim edilen
...

### Key Files
| File | Operation | Description |
|------|-----------|-------------|
| path/to/file.ts:L10-L50 | Modify | Description |

### Risks and Mitigation
| Risk | Mitigation |
|------|------------|

### SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: <session_id>
- GEMINI_SESSION: <session_id>
```

### Phase 2 End: Plan Teslimi (Execution Değil)

**`/ccg:plan` sorumlulukları burada biter, MUTLAKA şu aksiyonları çalıştır**:

1. Tam implementation planını kullanıcıya sun (pseudo-code dahil)
2. Planı `.claude/plan/<feature-name>.md`'ye kaydet (requirement'tan feature adını çıkar, örn., `user-auth`, `payment-module`)
3. **Kalın metinle** prompt çıktıla (MUTLAKA gerçek kaydedilen dosya yolunu kullan):

   ---
**Plan oluşturuldu ve `.claude/plan/actual-feature-name.md` dosyasına kaydedildi**

**Lütfen yukarıdaki planı inceleyin. Şunları yapabilirsiniz:**
- **Planı değiştir**: Neyin ayarlanması gerektiğini söyleyin, planı güncelleyeceğim
- **Planı çalıştır**: Aşağıdaki komutu yeni bir oturuma kopyalayın

   ```
   /ccg:execute .claude/plan/actual-feature-name.md
   ```
   ---

**NOT**: Yukarıdaki `actual-feature-name.md` gerçek kaydedilen dosya adıyla değiştirilmelidir!

4. **Mevcut yanıtı hemen sonlandır** (Burada dur. Daha fazla tool çağrısı yok.)

**KESINLIKLE YASAK**:
- Kullanıcıya "Y/N" sor sonra otomatik çalıştır (execution `/ccg:execute`'un sorumluluğudur)
- Production koduna herhangi bir yazma operasyonu
- `/ccg:execute`'u veya herhangi bir implementation aksiyonunu otomatik çağır
- Kullanıcı açıkça değişiklik talep etmediğinde model çağrılarını tetiklemeye devam et

---

## Plan Kaydetme

Planlama tamamlandıktan sonra, planı şuraya kaydet:

- **İlk planlama**: `.claude/plan/<feature-name>.md`
- **İterasyon versiyonları**: `.claude/plan/<feature-name>-v2.md`, `.claude/plan/<feature-name>-v3.md`...

Plan dosyası yazma, planı kullanıcıya sunmadan önce tamamlanmalı.

---

## Plan Değişiklik Akışı

Kullanıcı plan değişikliği talep ederse:

1. Kullanıcı geri bildirimine göre plan içeriğini ayarla
2. `.claude/plan/<feature-name>.md` dosyasını güncelle
3. Değiştirilmiş planı yeniden sun
4. Kullanıcıyı tekrar gözden geçirmeye veya çalıştırmaya davet et

---

## Sonraki Adımlar

Kullanıcı onayladıktan sonra, **manuel** olarak çalıştır:

```bash
/ccg:execute .claude/plan/<feature-name>.md
```

---

## Ana Kurallar

1. **Sadece plan, implementation yok** – Bu komut hiçbir kod değişikliği çalıştırmaz
2. **Y/N prompt'ları yok** – Sadece planı sun, kullanıcının sonraki adımlara karar vermesine izin ver
3. **Güven Kuralları** – Backend Codex'i takip eder, Frontend Gemini'yi takip eder
4. Harici modellerin **sıfır dosya sistemi yazma erişimi**
5. **SESSION_ID Devri** – Plan sonunda `CODEX_SESSION` / `GEMINI_SESSION` içermeli (`/ccg:execute resume <SESSION_ID>` kullanımı için)
