# Frontend - Frontend Odaklı Geliştirme

Frontend odaklı iş akışı (Research → Ideation → Plan → Execute → Optimize → Review), Gemini liderliğinde.

> **Ön koşul:** Bu komut, temel ECC kurulumunun parçası **olmayan** harici `ccg-workflow` runtime'ını gerektirir. Bu komutun bağımlı olduğu `~/.claude/bin/codeagent-wrapper` ve `~/.claude/.ccg/prompts/*` rol dosyalarını sağlamak için `npx ccg-workflow` komutuyla başlatın. Bu runtime olmadan bu komut düzgün çalışmaz.

## Kullanım

```bash
/frontend <UI task açıklaması>
```

## Context

- Frontend task: $ARGUMENTS
- Gemini liderliğinde, Codex yardımcı referans için
- Uygulanabilir: Component tasarımı, responsive layout, UI animasyonları, stil optimizasyonu

## Rolünüz

**Frontend Orkestratör**sünüz, UI/UX görevleri için multi-model işbirliğini koordine ediyorsunuz (Research → Ideation → Plan → Execute → Optimize → Review).

**İşbirlikçi Modeller**:
- **Gemini** – Frontend UI/UX (**Frontend otoritesi, güvenilir**)
- **Codex** – Backend perspektifi (**Frontend görüşleri sadece referans için**)
- **Claude (self)** – Orkestrasyon, planlama, execution, teslimat

---

## Multi-Model Çağrı Spesifikasyonu

**Çağrı Sözdizimi**:

```
# Yeni session çağrısı
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend gemini --gemini-model gemini-3-pro-preview - \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <enhanced requirement (veya enhance edilmediyse $ARGUMENTS)>
Context: <önceki fazlardan proje context'i ve analiz>
</TASK>
OUTPUT: Expected output format
EOF",
  run_in_background: false,
  timeout: 3600000,
  description: "Brief description"
})

# Session devam ettirme çağrısı
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend gemini --gemini-model gemini-3-pro-preview resume <SESSION_ID> - \"$PWD\" <<'EOF'
ROLE_FILE: <role prompt path>
<TASK>
Requirement: <enhanced requirement (veya enhance edilmediyse $ARGUMENTS)>
Context: <önceki fazlardan proje context'i ve analiz>
</TASK>
OUTPUT: Expected output format
EOF",
  run_in_background: false,
  timeout: 3600000,
  description: "Brief description"
})
```

**Role Prompts**:

| Phase | Gemini |
|-------|--------|
| Analysis | `~/.claude/.ccg/prompts/gemini/analyzer.md` |
| Planning | `~/.claude/.ccg/prompts/gemini/architect.md` |
| Review | `~/.claude/.ccg/prompts/gemini/reviewer.md` |

**Session Reuse**: Her çağrı `SESSION_ID: xxx` döndürür, sonraki fazlar için `resume xxx` kullan. Phase 2'de `GEMINI_SESSION` kaydet, Phase 3 ve 5'te `resume` kullan.

---

## İletişim Yönergeleri

1. Yanıtlara mode etiketi `[Mode: X]` ile başla, ilk `[Mode: Research]`
2. Katı sıra takip et: `Research → Ideation → Plan → Execute → Optimize → Review`
3. Gerektiğinde kullanıcı etkileşimi için `AskUserQuestion` tool kullan (örn., onay/seçim/approval)

---

## Ana İş Akışı

### Phase 0: Prompt Enhancement (İsteğe Bağlı)

`[Mode: Prepare]` - ace-tool MCP mevcutsa, `mcp__ace-tool__enhance_prompt` çağır, **orijinal $ARGUMENTS'ı sonraki Gemini çağrıları için enhanced sonuçla değiştir**. Mevcut değilse, `$ARGUMENTS`'ı olduğu gibi kullan.

### Phase 1: Research

`[Mode: Research]` - Requirement'ları anla ve context topla

1. **Code Retrieval** (ace-tool MCP mevcutsa): Mevcut component'leri, stilleri, tasarım sistemini almak için `mcp__ace-tool__search_context` çağır. Mevcut değilse, built-in tool'ları kullan: dosya keşfi için `Glob`, component/stil araması için `Grep`, context toplama için `Read`, daha derin keşif için `Task` (Explore agent).
2. Requirement tamamlılık skoru (0-10): >=7 devam et, <7 dur ve tamamla

### Phase 2: Ideation

`[Mode: Ideation]` - Gemini liderliğinde analiz

**Gemini'yi MUTLAKA çağır** (yukarıdaki çağrı spesifikasyonunu takip et):
- ROLE_FILE: `~/.claude/.ccg/prompts/gemini/analyzer.md`
- Requirement: Enhanced requirement (veya enhance edilmediyse $ARGUMENTS)
- Context: Phase 1'den proje context'i
- OUTPUT: UI fizibilite analizi, önerilen çözümler (en az 2), UX değerlendirmesi

**SESSION_ID'yi kaydet** (`GEMINI_SESSION`) sonraki faz yeniden kullanımı için.

Çözümleri çıktıla (en az 2), kullanıcı seçimini bekle.

### Phase 3: Planning

`[Mode: Plan]` - Gemini liderliğinde planlama

**Gemini'yi MUTLAKA çağır** (session'ı yeniden kullanmak için `resume <GEMINI_SESSION>` kullan):
- ROLE_FILE: `~/.claude/.ccg/prompts/gemini/architect.md`
- Requirement: Kullanıcının seçtiği çözüm
- Context: Phase 2'den analiz sonuçları
- OUTPUT: Component yapısı, UI akışı, stillendirme yaklaşımı

Claude planı sentezler, kullanıcı onayından sonra `.claude/plan/task-name.md`'ye kaydet.

### Phase 4: Implementation

`[Mode: Execute]` - Kod geliştirme

- Onaylanan planı kesinlikle takip et
- Mevcut proje tasarım sistemi ve kod standartlarını takip et
- Responsiveness, accessibility sağla

### Phase 5: Optimization

`[Mode: Optimize]` - Gemini liderliğinde review

**Gemini'yi MUTLAKA çağır** (yukarıdaki çağrı spesifikasyonunu takip et):
- ROLE_FILE: `~/.claude/.ccg/prompts/gemini/reviewer.md`
- Requirement: Aşağıdaki frontend kod değişikliklerini incele
- Context: git diff veya kod içeriği
- OUTPUT: Accessibility, responsiveness, performans, tasarım tutarlılığı sorunlar listesi

Review geri bildirimlerini entegre et, kullanıcı onayından sonra optimizasyonu çalıştır.

### Phase 6: Quality Review

`[Mode: Review]` - Nihai değerlendirme

- Plana karşı tamamlılığı kontrol et
- Responsiveness ve accessibility doğrula
- Sorunları ve önerileri raporla

---

## Ana Kurallar

1. **Gemini frontend görüşleri güvenilir**
2. **Codex frontend görüşleri sadece referans için**
3. Harici modellerin **sıfır dosya sistemi yazma erişimi**
4. Claude tüm kod yazma ve dosya operasyonlarını yönetir
