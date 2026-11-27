---
description: Tercih ettiğiniz paket yöneticisini yapılandırın (npm/pnpm/yarn/bun)
disable-model-invocation: true
---

# Paket Yöneticisi Kurulumu

Bu proje veya global olarak tercih ettiğiniz paket yöneticisini yapılandırın.

## Kullanım

```bash
# Mevcut paket yöneticisini tespit et
node scripts/setup-package-manager.js --detect

# Global tercihi ayarla
node scripts/setup-package-manager.js --global pnpm

# Proje tercihini ayarla
node scripts/setup-package-manager.js --project bun

# Mevcut paket yöneticilerini listele
node scripts/setup-package-manager.js --list
```

## Tespit Önceliği

Hangi paket yöneticisinin kullanılacağını belirlerken, şu sıra kontrol edilir:

1. **Environment variable**: `CLAUDE_PACKAGE_MANAGER`
2. **Proje config**: `.claude/package-manager.json`
3. **package.json**: `packageManager` alanı
4. **Lock dosyası**: package-lock.json, yarn.lock, pnpm-lock.yaml veya bun.lockb varlığı
5. **Global config**: `~/.claude/package-manager.json`
6. **Fallback**: İlk mevcut paket yöneticisi (pnpm > bun > yarn > npm)

## Yapılandırma Dosyaları

### Global Yapılandırma
```json
// ~/.claude/package-manager.json
{
  "packageManager": "pnpm"
}
```

### Proje Yapılandırması
```json
// .claude/package-manager.json
{
  "packageManager": "bun"
}
```

### package.json
```json
{
  "packageManager": "pnpm@8.6.0"
}
```

## Environment Variable

Tüm diğer tespit yöntemlerini geçersiz kılmak için `CLAUDE_PACKAGE_MANAGER` ayarlayın:

```bash
# Windows (PowerShell)
$env:CLAUDE_PACKAGE_MANAGER = "pnpm"

# macOS/Linux
export CLAUDE_PACKAGE_MANAGER=pnpm
```

## Tespiti Çalıştır

Mevcut paket yöneticisi tespit sonuçlarını görmek için şunu çalıştırın:

```bash
node scripts/setup-package-manager.js --detect
```
