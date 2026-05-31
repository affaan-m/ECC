---
name: evolve
description: İçgüdüleri analiz et ve evrimleşmiş yapılar öner veya oluştur
command: true
---

# Evolve Komutu

## Implementation

Run the instinct CLI after resolving the active ECC root (`CLAUDE_PLUGIN_ROOT`, standard install, plugin roots, plugin cache, then `~/.claude`) so stale manual installs cannot mask the active plugin (#2037):

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [['ecc'],['ecc@ecc'],['marketplace','ecc'],['everything-claude-code'],['everything-claude-code@everything-claude-code'],['marketplace','everything-claude-code']]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ['ecc','everything-claude-code']){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" evolve [--generate]
```

İçgüdüleri analiz eder ve ilgili olanları daha üst seviye yapılara kümelendirir:
- **Commands**: İçgüdüler kullanıcı tarafından çağrılan aksiyonları tanımladığında
- **Skills**: İçgüdüler otomatik tetiklenen davranışları tanımladığında
- **Agents**: İçgüdüler karmaşık, çok adımlı süreçleri tanımladığında

## Kullanım

```
/evolve                    # Tüm içgüdüleri analiz et ve evrimleri öner
/evolve --generate         # Ayrıca evolved/{skills,commands,agents} altında dosyalar oluştur
```

## Evrim Kuralları

### → Command (Kullanıcı Tarafından Çağrılan)
İçgüdüler kullanıcının açıkça talep edeceği aksiyonları tanımladığında:
- "Kullanıcı ... istediğinde" hakkında birden fazla içgüdü
- "Yeni X oluştururken" gibi tetikleyicilere sahip içgüdüler
- Tekrarlanabilir bir sıra izleyen içgüdüler

Örnek:
- `new-table-step1`: "veritabanı tablosu eklerken, migration oluştur"
- `new-table-step2`: "veritabanı tablosu eklerken, şemayı güncelle"
- `new-table-step3`: "veritabanı tablosu eklerken, tipleri yeniden oluştur"

→ Oluşturur: **new-table** komutu

### → Skill (Otomatik Tetiklenen)
İçgüdüler otomatik olarak gerçekleşmesi gereken davranışları tanımladığında:
- Pattern-matching tetikleyiciler
- Hata işleme yanıtları
- Kod stili zorlaması

Örnek:
- `prefer-functional`: "fonksiyon yazarken, functional stil tercih et"
- `use-immutable`: "state değiştirirken, immutable pattern kullan"
- `avoid-classes`: "modül tasarlarken, class-based tasarımdan kaçın"

→ Oluşturur: `functional-patterns` skill

### → Agent (Derinlik/İzolasyon Gerektirir)
İçgüdüler izolasyondan fayda sağlayan karmaşık, çok adımlı süreçleri tanımladığında:
- Debugging iş akışları
- Refactoring dizileri
- Araştırma görevleri

Örnek:
- `debug-step1`: "debug yaparken, önce logları kontrol et"
- `debug-step2`: "debug yaparken, başarısız componenti izole et"
- `debug-step3`: "debug yaparken, minimal reproduction oluştur"
- `debug-step4`: "debug yaparken, düzeltmeyi testle doğrula"

→ Oluşturur: **debugger** agent

## Yapılacaklar

1. Mevcut proje bağlamını tespit et
2. Proje + global içgüdüleri oku (ID çakışmalarında proje önceliklidir)
3. İçgüdüleri tetikleyici/domain desenlerine göre grupla
4. Şunları tanımla:
   - Skill adayları (2+ içgüdüye sahip tetikleyici kümeleri)
   - Command adayları (yüksek güvenli workflow içgüdüleri)
   - Agent adayları (daha büyük, yüksek güvenli kümeler)
5. Uygulanabilir durumlarda terfi adaylarını göster (proje -> global)
6. `--generate` geçilirse, dosyaları şuraya yaz:
   - Proje kapsamı: `~/.claude/homunculus/projects/<project-id>/evolved/`
   - Global fallback: `~/.claude/homunculus/evolved/`

## Çıktı Formatı

```
============================================================
  EVOLVE ANALYSIS - 12 instincts
  Project: my-app (a1b2c3d4e5f6)
  Project-scoped: 8 | Global: 4
============================================================

High confidence instincts (>=80%): 5

## SKILL CANDIDATES
1. Cluster: "adding tests"
   Instincts: 3
   Avg confidence: 82%
   Domains: testing
   Scopes: project

## COMMAND CANDIDATES (2)
  /adding-tests
    From: test-first-workflow [project]
    Confidence: 84%

## AGENT CANDIDATES (1)
  adding-tests-agent
    Covers 3 instincts
    Avg confidence: 82%
```

## Bayraklar

- `--generate`: Analiz çıktısına ek olarak evrimleşmiş dosyaları oluştur

## Oluşturulan Dosya Formatı

### Command
```markdown
---
name: new-table
description: Migration, şema güncellemesi ve tip oluşturma ile yeni veritabanı tablosu oluştur
command: /new-table
evolved_from:
  - new-table-migration
  - update-schema
  - regenerate-types
---

# New Table Command

[Kümelenmiş içgüdülere dayalı oluşturulan içerik]

## Steps
1. ...
2. ...
```

### Skill
```markdown
---
name: functional-patterns
description: Functional programming pattern'lerini zorla
evolved_from:
  - prefer-functional
  - use-immutable
  - avoid-classes
---

# Functional Patterns Skill

[Kümelenmiş içgüdülere dayalı oluşturulan içerik]
```

### Agent
```markdown
---
name: debugger
description: Sistematik debugging agent
model: sonnet
evolved_from:
  - debug-check-logs
  - debug-isolate
  - debug-reproduce
---

# Debugger Agent

[Kümelenmiş içgüdülere dayalı oluşturulan içerik]
```
