---
name: instinct-import
description: İçgüdüleri dosya veya URL'den proje/global kapsama aktar
command: true
---

# Instinct Import Komutu

## Implementation

Run the instinct CLI after resolving the active ECC root (`CLAUDE_PLUGIN_ROOT`, standard install, plugin roots, plugin cache, then `~/.claude`) so stale manual installs cannot mask the active plugin (#2037):

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [['ecc'],['ecc@ecc'],['marketplace','ecc'],['everything-claude-code'],['everything-claude-code@everything-claude-code'],['marketplace','everything-claude-code']]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ['ecc','everything-claude-code']){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" import <file-or-url> [--dry-run] [--force] [--min-confidence 0.7] [--scope project|global]
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
