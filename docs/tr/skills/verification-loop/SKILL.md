---
name: verification-loop
description: "Claude Code oturumları için kapsamlı doğrulama sistemi."
origin: ECC
---

# Verification Loop Skill

Claude Code oturumları için kapsamlı doğrulama sistemi.

## Ne Zaman Kullanılır

Bu skill'i şu durumlarda çağır:
- Bir özellik veya önemli kod değişikliği tamamladıktan sonra
- PR oluşturmadan önce
- Kalite kapılarının geçtiğinden emin olmak istediğinde
- Refactoring sonrasında

## Doğrulama Fazları

### Faz 1: Build Doğrulaması
```bash
# Projenin build olup olmadığını kontrol et
npm run build 2>&1 | tail -20
# VEYA
pnpm build 2>&1 | tail -20
```

Build başarısız olursa, devam etmeden önce DUR ve düzelt.

### Faz 2: Tip Kontrolü
```bash
# TypeScript projeleri
npx tsc --noEmit 2>&1 | head -30

# Python projeleri
pyright . 2>&1 | head -30
```

Tüm tip hatalarını raporla. Devam etmeden önce kritik olanları düzelt.

### Faz 3: Lint Kontrolü
```bash
# JavaScript/TypeScript
npm run lint 2>&1 | head -30

# Python
ruff check . 2>&1 | head -30
```

### Faz 4: Test Paketi
```bash
# Testleri coverage ile çalıştır
npm run test -- --coverage 2>&1 | tail -50

# Coverage eşiğini kontrol et
# Hedef: minimum %80
```

Rapor:
- Toplam testler: X
- Geçti: X
- Başarısız: X
- Coverage: %X

### Faz 5: Güvenlik Taraması
```bash
# Secret'ları kontrol et
grep -rn "sk-" --include="*.ts" --include="*.js" . 2>/dev/null | head -10
grep -rn "api_key" --include="*.ts" --include="*.js" . 2>/dev/null | head -10

# console.log kontrol et
grep -rn "console.log" --include="*.ts" --include="*.tsx" src/ 2>/dev/null | head -10
```

### Faz 6: Diff İncelemesi
```bash
# Neyin değiştiğini göster
git diff --stat
git diff HEAD~1 --name-only
```

Her değişen dosyayı şunlar için incele:
- İstenmeyen değişiklikler
- Eksik hata işleme
- Potansiyel edge case'ler

## Çıktı Formatı

Tüm fazları çalıştırdıktan sonra, bir doğrulama raporu üret:

```
DOĞRULAMA RAPORU
==================

Build:     [PASS/FAIL]
Tipler:    [PASS/FAIL] (X hata)
Lint:      [PASS/FAIL] (X uyarı)
Testler:   [PASS/FAIL] (X/Y geçti, %Z coverage)
Güvenlik:  [PASS/FAIL] (X sorun)
Diff:      [X dosya değişti]

Genel:     PR için [HAZIR/HAZIR DEĞİL]

Düzeltilmesi Gereken Sorunlar:
1. ...
2. ...
```

## Sürekli Mod

Uzun oturumlar için, her 15 dakikada bir veya major değişikliklerden sonra doğrulama çalıştır:

```markdown
Mental kontrol noktası belirle:
- Her fonksiyonu tamamladıktan sonra
- Bir component'i bitirdikten sonra
- Sonraki göreve geçmeden önce

Çalıştır: /verify
```

## Hook'larla Entegrasyon

Bu skill PostToolUse hook'larını tamamlar ancak daha derin doğrulama sağlar.
Hook'lar sorunları anında yakalar; bu skill kapsamlı inceleme sağlar.
