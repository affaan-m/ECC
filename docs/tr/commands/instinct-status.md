---
name: instinct-status
description: Öğrenilen içgüdüleri (proje + global) güven seviyesiyle göster
command: true
---

# Instinct Status Komutu

Mevcut proje için öğrenilen içgüdüleri ve global içgüdüleri, domain'e göre gruplandırılmış şekilde gösterir.

## Uygulama

Etkin ECC kökünü hook bootstrap ve diğer slash komutlarıyla aynı sırayla (`CLAUDE_PLUGIN_ROOT`, standart kurulum, bilinen plugin kökleri, plugin cache, son olarak `~/.claude`) çözümledikten sonra instinct CLI'ı çalıştırır. Böylece plugin aktifken slash komut kabuğunda `CLAUDE_PLUGIN_ROOT` boşsa eski manuel kurulumun okunması engellenir (#2037).

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [["ecc"],["ecc@ecc"],["marketplace","ecc"],["everything-claude-code"],["everything-claude-code@everything-claude-code"],["marketplace","everything-claude-code"]]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ["ecc","everything-claude-code"]){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" status
```

## Kullanım

```
/instinct-status
```

## Yapılacaklar

1. Mevcut proje bağlamını tespit et (git remote/path hash)
2. `~/.claude/homunculus/projects/<project-id>/instincts/` konumundan proje içgüdülerini oku
3. `~/.claude/homunculus/instincts/` konumundan global içgüdüleri oku
4. Öncelik kurallarıyla birleştir (ID çakışmasında proje global'i geçersiz kılar)
5. Domain'e göre gruplandırılmış, güven çubukları ve gözlem istatistikleriyle göster

## Çıktı Formatı

```
============================================================
  INSTINCT STATUS - 12 total
============================================================

  Project: my-app (a1b2c3d4e5f6)
  Project instincts: 8
  Global instincts:  4

## PROJECT-SCOPED (my-app)
  ### WORKFLOW (3)
    ███████░░░  70%  grep-before-edit [project]
              trigger: when modifying code

## GLOBAL (apply to all projects)
  ### SECURITY (2)
    █████████░  85%  validate-user-input [global]
              trigger: when handling user input
```
