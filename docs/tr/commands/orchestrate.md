---
description: Multi-agent iş akışları için sıralı ve tmux/worktree orkestrasyon rehberi.
---

# Orchestrate Komutu

Karmaşık görevler için sıralı agent iş akışı.

## Kullanım

`/orchestrate [workflow-type] [task-description]`

## Workflow Tipleri

### feature
Tam özellik implementasyon iş akışı:
```
planner -> tdd-guide -> code-reviewer -> security-reviewer
```

### bugfix
Bug araştırma ve düzeltme iş akışı:
```
planner -> tdd-guide -> code-reviewer
```

### refactor
Güvenli refactoring iş akışı:
```
architect -> code-reviewer -> tdd-guide
```

### security
Güvenlik odaklı review:
```
security-reviewer -> code-reviewer -> architect
```

## Execution Pattern

İş akışındaki her agent için:

1. **Agent'ı çağır** önceki agent'tan gelen context ile
2. **Çıktıyı topla** yapılandırılmış handoff dokümanı olarak
3. **Sonraki agent'a geçir** zincirde
4. **Sonuçları topla** nihai rapora

## Handoff Doküman Formatı

Agent'lar arasında, handoff dokümanı oluştur:

```markdown
## HANDOFF: [previous-agent] -> [next-agent]

### Context
[Yapılanların özeti]

### Findings
[Anahtar keşifler veya kararlar]

### Files Modified
[Dokunulan dosyaların listesi]

### Open Questions
[Sonraki agent için çözülmemiş öğeler]

### Recommendations
[Önerilen sonraki adımlar]
```

## Örnek: Feature Workflow

```
/orchestrate feature "Add user authentication"
```

Çalıştırır:

1. **Planner Agent**
   - Requirement'ları analiz eder
   - Implementation planı oluşturur
   - Bağımlılıkları tanımlar
   - Çıktı: `HANDOFF: planner -> tdd-guide`

2. **TDD Guide Agent**
   - Planner handoff'unu okur
   - Önce test'leri yazar
   - Test'leri geçirmek için implement eder
   - Çıktı: `HANDOFF: tdd-guide -> code-reviewer`

3. **Code Reviewer Agent**
   - Implementation'ı gözden geçirir
   - Sorunları kontrol eder
   - İyileştirmeler önerir
   - Çıktı: `HANDOFF: code-reviewer -> security-reviewer`

4. **Security Reviewer Agent**
   - Güvenlik denetimi
   - Güvenlik açığı kontrolü
   - Nihai onay
   - Çıktı: Final Report

## Nihai Rapor Formatı

```
ORCHESTRATION REPORT
====================
Workflow: feature
Task: Add user authentication
Agents: planner -> tdd-guide -> code-reviewer -> security-reviewer

SUMMARY
-------
[Bir paragraf özet]

AGENT OUTPUTS
-------------
Planner: [özet]
TDD Guide: [özet]
Code Reviewer: [özet]
Security Reviewer: [özet]

FILES CHANGED
-------------
[Değiştirilen tüm dosyaların listesi]

TEST RESULTS
------------
[Test geçti/başarısız özeti]

SECURITY STATUS
---------------
[Güvenlik bulguları]

RECOMMENDATION
--------------
[SHIP / NEEDS WORK / BLOCKED]
```

## Parallel Execution

Bağımsız kontroller için, agent'ları parallel çalıştır:

```markdown
### Parallel Phase
Eş zamanlı çalıştır:
- code-reviewer (kalite)
- security-reviewer (güvenlik)
- architect (tasarım)

### Merge Results
Çıktıları tek rapora birleştir
```

Ayrı git worktree'leri olan harici tmux-pane worker'ları için, `node scripts/orchestrate-worktrees.js plan.json --execute` kullan. Built-in orkestrasyon pattern'i in-process kalır; helper uzun süren veya cross-harness session'lar için.

Worker'ların ana checkout'tan kirli veya izlenmeyen yerel dosyaları görmesi gerektiğinde, plan dosyasına `seedPaths` ekle. ECC sadece seçilen bu yolları `git worktree add`'den sonra her worker worktree'sine overlay eder; bu branch'ı izole tutarken devam eden yerel script'leri, planları veya dokümanları gösterir.

```json
{
  "sessionName": "workflow-e2e",
  "seedPaths": [
    "scripts/orchestrate-worktrees.js",
    "scripts/lib/tmux-worktree-orchestrator.js",
    ".claude/plan/workflow-e2e-test.json"
  ],
  "workers": [
    { "name": "docs", "task": "Orkestrasyon dokümanlarını güncelle." }
  ]
}
```

Canlı bir tmux/worktree session için kontrol düzlemi snapshot'ı dışa aktarmak için şunu çalıştır:

```bash
node scripts/orchestration-status.js .claude/plan/workflow-visual-proof.json
```

Snapshot session aktivitesi, tmux pane metadata'sı, worker state'leri, hedefleri, seed overlay'leri ve son handoff özetlerini JSON formatında içerir.

## Operatör Command-Center Handoff

İş akışı birden fazla session, worktree veya tmux pane'e yayıldığında, nihai handoff'a bir kontrol düzlemi bloğu ekle:

```markdown
CONTROL PLANE
-------------
Sessions:
- aktif session ID veya alias
- her aktif worker için branch + worktree yolu
- uygulanabilir durumlarda tmux pane veya detached session adı

Diffs:
- git status özeti
- dokunulan dosyalar için git diff --stat
- merge/çakışma risk notları

Approvals:
- bekleyen kullanıcı onayları
- onay bekleyen bloke adımlar

Telemetry:
- son aktivite timestamp'i veya idle sinyali
- tahmini token veya cost drift
- hook'lar veya reviewer'lar tarafından bildirilen policy olayları
```

Bu planner, implementer, reviewer ve loop worker'larını operatör yüzeyinden anlaşılır tutar.

## Argümanlar

$ARGUMENTS:
- `feature <description>` - Tam özellik iş akışı
- `bugfix <description>` - Bug düzeltme iş akışı
- `refactor <description>` - Refactoring iş akışı
- `security <description>` - Güvenlik review iş akışı
- `custom <agents> <description>` - Özel agent dizisi

## Özel Workflow Örneği

```
/orchestrate custom "architect,tdd-guide,code-reviewer" "Caching katmanını yeniden tasarla"
```

## İpuçları

1. **Karmaşık özellikler için planner ile başla**
2. **Merge'den önce her zaman code-reviewer dahil et**
3. **Auth/ödeme/PII için security-reviewer kullan**
4. **Handoff'ları kısa tut** - sonraki agent'ın ihtiyaç duyduğu şeye odaklan
5. **Gerekirse agent'lar arasında doğrulama çalıştır**
