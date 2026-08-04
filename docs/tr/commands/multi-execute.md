# Execute - Multi-Model İşbirlikçi Execution

Multi-model işbirlikçi execution - Plandan prototype al → Claude refactor edip implement eder → Multi-model audit ve teslimat.

> **Ön koşul:** Bu komut, temel ECC kurulumunun parçası **olmayan** harici `ccg-workflow` runtime'ını gerektirir. Bu komutun bağımlı olduğu `~/.claude/bin/codeagent-wrapper` ve `~/.claude/.ccg/prompts/*` rol dosyalarını sağlamak için `npx ccg-workflow` komutuyla başlatın. Bu runtime olmadan bu komut düzgün çalışmaz.

$ARGUMENTS

---

## Ana Protokoller

- **Dil Protokolü**: Tool/model'lerle etkileşimde **İngilizce** kullan, kullanıcıyla kendi dilinde iletişim kur
- **Kod Egemenliği**: Harici modellerin **sıfır dosya sistemi yazma erişimi**, tüm değişiklikler Claude tarafından
- **Dirty Prototype Refactoring**: Codex/Gemini Unified Diff'i "dirty prototype" olarak değerlendir, production-grade koda refactor edilmeli
- **Stop-Loss Mekanizması**: Mevcut faz çıktısı doğrulanana kadar bir sonraki faza geçme
- **Ön Koşul**: Sadece kullanıcı `/ccg:plan` çıktısına açıkça "Y" cevabı verdikten sonra çalıştır (eksikse, önce onay al)

---

## Multi-Model Çağrı Spesifikasyonu

**Çağrı Sözdizimi** (parallel: `run_in_background: true` kullan):

```
# Session devam ettirme çağrısı (önerilen) - Implementation Prototype
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <task description>
Context: <plan content + target files>
</TASK>
OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Brief description"
})

# Yeni session çağrısı - Implementation Prototype
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}- \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <task description>
Context: <plan content + target files>
</TASK>
OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Brief description"
})
```

**Audit Çağrı Sözdizimi** (Code Review / Audit):

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Scope: Audit the final code changes.
Inputs:
- The applied patch (git diff / final unified diff)
- The touched files (relevant excerpts if needed)
Constraints:
- Do NOT modify any files.
- Do NOT output tool commands that assume filesystem access.
</TASK>
OUTPUT:
1) A prioritized list of issues (severity, file, rationale)
2) Concrete fixes; if code changes are needed, include a Unified Diff Patch in a fenced code block.
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
| Implementation | `~/.claude/.ccg/prompts/codex/architect.md` | `~/.claude/.ccg/prompts/gemini/frontend.md` |
| Review | `~/.claude/.ccg/prompts/codex/reviewer.md` | `~/.claude/.ccg/prompts/gemini/reviewer.md` |

**Session Reuse**: `/ccg:plan` SESSION_ID sağladıysa, context'i yeniden kullanmak için `resume <SESSION_ID>` kullan.

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

**Execute Task**: $ARGUMENTS

### Phase 0: Planı Oku

`[Mode: Prepare]`

1. **Input Tipini Tanımla**:
   - Plan dosya yolu (örn., `.claude/plan/xxx.md`)
   - Doğrudan task açıklaması

2. **Plan İçeriğini Oku**:
   - Plan dosya yolu sağlandıysa, oku ve ayrıştır
   - Çıkar: task tipi, implementation adımları, anahtar dosyalar, SESSION_ID

3. **Pre-Execution Onayı**:
   - Input "doğrudan task açıklaması" veya plan `SESSION_ID` / anahtar dosyalar eksikse: önce kullanıcıyla onay al
   - Kullanıcının plana "Y" cevabı verdiğini onaylayamazsan: devam etmeden önce tekrar onay al

4. **Task Tipi Routing**:

   | Task Type | Detection | Route |
   |-----------|-----------|-------|
   | **Frontend** | Pages, components, UI, styles, layout | Gemini |
   | **Backend** | API, interfaces, database, logic, algorithms | Codex |
   | **Fullstack** | Hem frontend hem de backend içerir | Codex ∥ Gemini parallel |

---

### Phase 1: Hızlı Context Retrieval

`[Mode: Retrieval]`

**ace-tool MCP mevcutsa**, hızlı context retrieval için kullan:

Plandaki "Key Files" listesine göre, `mcp__ace-tool__search_context` çağır:

```
mcp__ace-tool__search_context({
  query: "<plan içeriğine dayalı semantik sorgu, anahtar dosyalar, modüller, fonksiyon adları dahil>",
  project_root_path: "$PWD"
})
```

**Retrieval Stratejisi**:
- Planın "Key Files" tablosundan hedef yolları çıkar
- Semantik sorgu oluştur: giriş dosyaları, bağımlılık modülleri, ilgili tip tanımları
- Sonuçlar yetersizse, 1-2 recursive retrieval ekle

**ace-tool MCP mevcut DEĞİLSE**, fallback olarak Claude Code built-in tool'ları kullan:
1. **Glob**: Planın "Key Files" tablosundan hedef dosyaları bul (örn., `Glob("src/components/**/*.tsx")`)
2. **Grep**: Codebase genelinde anahtar semboller, fonksiyon adları, tip tanımlarını ara
3. **Read**: Tam context toplamak için keşfedilen dosyaları oku
4. **Task (Explore agent)**: Daha geniş keşif için, `Task`'ı `subagent_type: "Explore"` ile kullan

**Retrieval Sonrası**:
- Alınan kod snippet'lerini organize et
- Implementation için tam context'i onayla
- Phase 3'e geç

---

### Phase 3: Prototype Edinimi

`[Mode: Prototype]`

**Task Tipine Göre Route Et**:

#### Route A: Frontend/UI/Styles → Gemini

**Limit**: Context < 32k token

1. Gemini'yi çağır (`~/.claude/.ccg/prompts/gemini/frontend.md` kullan)
2. Input: Plan içeriği + alınan context + hedef dosyalar
3. OUTPUT: `Unified Diff Patch ONLY. Strictly prohibit any actual modifications.`
4. **Gemini frontend tasarım otoritesidir, CSS/React/Vue prototype'ı nihai görsel temeldir**
5. **UYARI**: Gemini'nin backend logic önerilerini yoksay
6. Plan `GEMINI_SESSION` içeriyorsa: `resume <GEMINI_SESSION>` tercih et

#### Route B: Backend/Logic/Algorithms → Codex

1. Codex'i çağır (`~/.claude/.ccg/prompts/codex/architect.md` kullan)
2. Input: Plan içeriği + alınan context + hedef dosyalar
3. OUTPUT: `Unified Diff Patch ONLY. Strictly prohibit any actual modifications.`
4. **Codex backend logic otoritesidir, mantıksal akıl yürütme ve debug yeteneklerinden faydalan**
5. Plan `CODEX_SESSION` içeriyorsa: `resume <CODEX_SESSION>` tercih et

#### Route C: Fullstack → Parallel Çağrılar

1. **Parallel Çağrılar** (`run_in_background: true`):
   - Gemini: Frontend kısmını ele al
   - Codex: Backend kısmını ele al
2. `TaskOutput` ile her iki modelin tam sonuçlarını bekle
3. Her biri `resume` için plandan ilgili `SESSION_ID`'yi kullanır (eksikse yeni session oluştur)

**Yukarıdaki `Multi-Model Çağrı Spesifikasyonu`'ndaki `ÖNEMLİ` talimatları takip et**

---

### Phase 4: Code Implementation

`[Mode: Implement]`

**Kod Egemenliği olarak Claude şu adımları çalıştırır**:

1. **Diff Oku**: Codex/Gemini'nin döndürdüğü Unified Diff Patch'i ayrıştır

2. **Mental Sandbox**:
   - Diff'in hedef dosyalara uygulanmasını simüle et
   - Mantıksal tutarlılığı kontrol et
   - Potansiyel çakışmaları veya yan etkileri tanımla

3. **Refactor ve Temizle**:
   - "Dirty prototype"'ı **yüksek okunabilir, sürdürülebilir, enterprise-grade koda** refactor et
   - Gereksiz kodu kaldır
   - Projenin mevcut kod standartlarına uygunluğu sağla
   - **Gerekli olmadıkça yorum/doküman oluşturma**, kod kendi kendini açıklamalı

4. **Minimal Kapsam**:
   - Değişiklikler sadece requirement kapsamıyla sınırlı
   - Yan etkiler için **zorunlu gözden geçirme**
   - Hedefli düzeltmeler yap

5. **Değişiklikleri Uygula**:
   - Gerçek değişiklikleri çalıştırmak için Edit/Write tool'larını kullan
   - **Sadece gerekli kodu değiştir**, kullanıcının diğer mevcut fonksiyonlarını asla etkileme

6. **Self-Verification** (şiddetle önerilir):
   - Projenin mevcut lint / typecheck / test'lerini çalıştır (minimal ilgili kapsama öncelik ver)
   - Başarısız olursa: önce regresyonları düzelt, sonra Phase 5'e geç

---

### Phase 5: Audit ve Teslimat

`[Mode: Audit]`

#### 5.1 Otomatik Audit

**Değişiklikler yürürlüğe girdikten sonra, MUTLAKA hemen parallel call** Codex ve Gemini'yi Code Review için:

1. **Codex Review** (`run_in_background: true`):
   - ROLE_FILE: `~/.claude/.ccg/prompts/codex/reviewer.md`
   - Input: Değiştirilen Diff + hedef dosyalar
   - Odak: Güvenlik, performans, hata işleme, logic doğruluğu

2. **Gemini Review** (`run_in_background: true`):
   - ROLE_FILE: `~/.claude/.ccg/prompts/gemini/reviewer.md`
   - Input: Değiştirilen Diff + hedef dosyalar
   - Odak: Erişilebilirlik, tasarım tutarlılığı, kullanıcı deneyimi

`TaskOutput` ile her iki modelin tam review sonuçlarını bekle. Context tutarlılığı için Phase 3 session'larını yeniden kullanmayı tercih et (`resume <SESSION_ID>`).

#### 5.2 Entegre Et ve Düzelt

1. Codex + Gemini review geri bildirimlerini sentezle
2. Güven kurallarına göre değerlendir: Backend Codex'i takip eder, Frontend Gemini'yi takip eder
3. Gerekli düzeltmeleri çalıştır
4. Gerektiğinde Phase 5.1'i tekrarla (risk kabul edilebilir olana kadar)

#### 5.3 Teslimat Onayı

Audit geçtikten sonra, kullanıcıya rapor et:

```markdown
## Execution Complete

### Change Summary
| File | Operation | Description |
|------|-----------|-------------|
| path/to/file.ts | Modified | Description |

### Audit Results
- Codex: <Passed/Found N issues>
- Gemini: <Passed/Found N issues>

### Recommendations
1. [ ] <Önerilen test adımları>
2. [ ] <Önerilen doğrulama adımları>
```

---

## Ana Kurallar

1. **Kod Egemenliği** – Tüm dosya değişiklikleri Claude tarafından, harici modellerin sıfır yazma erişimi
2. **Dirty Prototype Refactoring** – Codex/Gemini çıktısı taslak olarak değerlendirilir, refactor edilmeli
3. **Güven Kuralları** – Backend Codex'i takip eder, Frontend Gemini'yi takip eder
4. **Minimal Değişiklikler** – Sadece gerekli kodu değiştir, yan etki yok
5. **Zorunlu Audit** – Değişikliklerden sonra multi-model Code Review yapılmalı

---

## Kullanım

```bash
# Plan dosyasını çalıştır
/ccg:execute .claude/plan/feature-name.md

# Task'i doğrudan çalıştır (context'te zaten tartışılmış planlar için)
/ccg:execute implement user authentication based on previous plan
```

---

## /ccg:plan ile İlişki

1. `/ccg:plan` plan + SESSION_ID oluşturur
2. Kullanıcı "Y" ile onaylar
3. `/ccg:execute` planı okur, SESSION_ID'yi yeniden kullanır, implementation'ı çalıştırır
