# Eval Komutu

Eval-odaklı geliştirme iş akışını yönet.

## Kullanım

`/eval [define|check|report|list] [feature-name]`

## Eval Tanımla

`/eval define feature-name`

Yeni bir eval tanımı oluştur:

1. Şablonla `.claude/evals/feature-name.md` oluştur:

```markdown
## EVAL: feature-name
Created: $(date)

### Capability Evals
- [ ] [Capability 1 açıklaması]
- [ ] [Capability 2 açıklaması]

### Regression Evals
- [ ] [Mevcut davranış 1 hala çalışıyor]
- [ ] [Mevcut davranış 2 hala çalışıyor]

### Success Criteria
- pass@3 > 90% for capability evals
- pass^3 = 100% for regression evals
```

2. Kullanıcıdan belirli kriterleri doldurmasını iste

## Eval Kontrol Et

`/eval check feature-name`

Bir özellik için eval'ları çalıştır:

1. `.claude/evals/feature-name.md` dosyasından eval tanımını oku
2. Her capability eval için:
   - Kriteri doğrulamayı dene
   - PASS/FAIL kaydet
   - Denemeyi `.claude/evals/feature-name.log` dosyasına kaydet
3. Her regression eval için:
   - İlgili test'leri çalıştır
   - Baseline ile karşılaştır
   - PASS/FAIL kaydet
4. Mevcut durumu raporla:

```
EVAL CHECK: feature-name
========================
Capability: X/Y passing
Regression: X/Y passing
Status: IN PROGRESS / READY
```

## Eval Raporu

`/eval report feature-name`

Kapsamlı eval raporu oluştur:

```
EVAL REPORT: feature-name
=========================
Generated: $(date)

CAPABILITY EVALS
----------------
[eval-1]: PASS (pass@1)
[eval-2]: PASS (pass@2) - required retry
[eval-3]: FAIL - see notes

REGRESSION EVALS
----------------
[test-1]: PASS
[test-2]: PASS
[test-3]: PASS

METRICS
-------
Capability pass@1: 67%
Capability pass@3: 100%
Regression pass^3: 100%

NOTES
-----
[Herhangi bir sorun, edge case veya gözlem]

RECOMMENDATION
--------------
[SHIP / NEEDS WORK / BLOCKED]
```

## Eval'ları Listele

`/eval list`

Tüm eval tanımlarını göster:

```
EVAL DEFINITIONS
================
feature-auth      [3/5 passing] IN PROGRESS
feature-search    [5/5 passing] READY
feature-export    [0/4 passing] NOT STARTED
```

## Argümanlar

$ARGUMENTS:
- `define <name>` - Yeni eval tanımı oluştur
- `check <name>` - Eval'ları çalıştır ve kontrol et
- `report <name>` - Tam rapor oluştur
- `list` - Tüm eval'ları göster
- `clean` - Eski eval loglarını kaldır (son 10 çalıştırmayı tutar)
