---
name: instinct-import
description: İçgüdüleri dosya veya URL'den proje/global kapsama aktar
command: true
---

# Instinct Import Komutu

## Uygulama

Plugin root path kullanarak instinct CLI'ı çalıştır:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" import <file-or-url> [--dry-run] [--force] [--min-confidence 0.7] [--scope project|global]
```

Veya `CLAUDE_PLUGIN_ROOT` ayarlanmamışsa (manuel kurulum):

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py import <file-or-url>
```

Yerel dosya yollarından veya HTTP(S) URL'lerinden içgüdüleri içe aktar.

## Kullanım

```
/instinct-import team-instincts.yaml
/instinct-import https://raw.githubusercontent.com/org/repo/main/instincts.yaml
/instinct-import team-instincts.yaml --dry-run
/instinct-import team-instincts.yaml --scope global --force
```

## Yapılacaklar

1. İçgüdü dosyasını al (yerel yol veya URL)
2. Formatı doğrula ve ayrıştır
3. Mevcut içgüdülerle duplikasyon kontrolü yap
4. Yeni içgüdüleri birleştir veya ekle
5. İçgüdüleri inherited dizinine kaydet:
   - Proje kapsamı: `~/.claude/homunculus/projects/<project-id>/instincts/inherited/`
   - Global kapsam: `~/.claude/homunculus/instincts/inherited/`

## İçe Aktarma İşlemi

```
 Importing instincts from: team-instincts.yaml
================================================

Found 12 instincts to import.

Analyzing conflicts...

## New Instincts (8)
These will be added:
  ✓ use-zod-validation (confidence: 0.7)
  ✓ prefer-named-exports (confidence: 0.65)
  ✓ test-async-functions (confidence: 0.8)
  ...

## Duplicate Instincts (3)
Already have similar instincts:
  WARNING: prefer-functional-style
     Local: 0.8 confidence, 12 observations
     Import: 0.7 confidence
     → Keep local (higher confidence)

  WARNING: test-first-workflow
     Local: 0.75 confidence
     Import: 0.9 confidence
     → Update to import (higher confidence)

Import 8 new, update 1?
```

## Birleştirme Davranışı

Mevcut ID'ye sahip bir içgüdü içe aktarılırken:
- Daha yüksek güvenli içe aktarma güncelleme adayı olur
- Eşit/düşük güvenli içe aktarma atlanır
- `--force` kullanılmadıkça kullanıcı onaylar

## Kaynak İzleme

İçe aktarılan içgüdüler şu şekilde işaretlenir:
```yaml
source: inherited
scope: project
imported_from: "team-instincts.yaml"
project_id: "a1b2c3d4e5f6"
project_name: "my-project"
```

## Bayraklar

- `--dry-run`: İçe aktarmadan önizle
- `--force`: Onay istemini atla
- `--min-confidence <n>`: Sadece eşiğin üzerindeki içgüdüleri içe aktar
- `--scope <project|global>`: Hedef kapsamı seç (varsayılan: `project`)

## Çıktı

İçe aktarma sonrası:
```
PASS: Import complete!

Added: 8 instincts
Updated: 1 instinct
Skipped: 3 instincts (equal/higher confidence already exists)

New instincts saved to: ~/.claude/homunculus/instincts/inherited/

Run /instinct-status to see all instincts.
```
