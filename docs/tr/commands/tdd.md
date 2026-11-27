---
description: Test odaklı geliştirme (TDD) iş akışını zorlar. Interface'leri tasarla, ÖNCE testleri oluştur, sonra minimal kodu uygula. %80+ kod kapsama oranı sağla.
---

# TDD Komutu

Bu komut, test odaklı geliştirme metodolojisini zorlamak için **tdd-guide** agent'ını çağırır.

## Bu Komut Ne Yapar

1. **Interface'leri Tasarla** - Önce tip/interface'leri tanımla
2. **Önce Testleri Oluştur** - Başarısız testler yaz (RED)
3. **Minimal Kod Uygula** - Geçmek için yeterli kodu yaz (GREEN)
4. **Refactor Et** - Testleri yeşil tutarken kodu iyileştir (REFACTOR)
5. **Kapsama Oranını Doğrula** - %80+ test kapsama oranı sağla

## Ne Zaman Kullanılır

`/tdd` komutunu şu durumlarda kullanın:
- Yeni özellikler uygularken
- Yeni fonksiyonlar/componentler eklerken
- Hataları düzeltirken (önce hatayı tekrar eden test yaz)
- Mevcut kodu refactor ederken
- Kritik iş mantığı oluştururken

## Nasıl Çalışır

tdd-guide agent'ı şunları yapacaktır:

1. Giriş/çıkışlar için **interface'leri tanımla**
2. **BAŞARISIZ olacak testleri yaz** (çünkü kod henüz yok)
3. **Testleri çalıştır** ve doğru sebepten başarısız olduklarını doğrula
4. Testleri geçirmek için **minimal uygulama yaz**
5. **Testleri çalıştır** ve geçtiklerini doğrula
6. Testleri yeşil tutarken kodu **refactor et**
7. **Kapsama oranını kontrol et** ve %80'in altındaysa daha fazla test ekle

## TDD Döngüsü

```
RED → GREEN → REFACTOR → TEKRARLA

RED:      Başarısız bir test yaz
GREEN:    Geçmek için minimal kod yaz
REFACTOR: Kodu iyileştir, testleri geçmeye devam et
TEKRARLA: Bir sonraki özellik/senaryo
```

## Örnek Kullanım

```
Kullanıcı: /tdd Piyasa likidite skorunu hesaplamak için bir fonksiyona ihtiyacım var

Agent (tdd-guide):
# TDD Oturumu: Piyasa Likidite Skoru Hesaplayıcı

## Adım 1: Interface Tanımla (SCAFFOLD)

```typescript
// lib/liquidity.ts
export interface MarketData {
  totalVolume: number
  bidAskSpread: number
  activeTraders: number
  lastTradeTime: Date
}

export function calculateLiquidityScore(market: MarketData): number {
  // TODO: Uygulama
  throw new Error('Not implemented')
}
```

## Adım 2: Başarısız Test Yaz (RED)

```typescript
// lib/liquidity.test.ts
import { calculateLiquidityScore } from './liquidity'

describe('calculateLiquidityScore', () => {
  it('likit piyasa için yüksek skor döndürmeli', () => {
    const market = {
      totalVolume: 100000,
      bidAskSpread: 0.01,
      activeTraders: 500,
      lastTradeTime: new Date()
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeGreaterThan(80)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('az likit piyasa için düşük skor döndürmeli', () => {
    const market = {
      totalVolume: 100,
      bidAskSpread: 0.5,
      activeTraders: 2,
      lastTradeTime: new Date(Date.now() - 86400000) // 1 gün önce
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeLessThan(30)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('edge case\'i idare etmeli: sıfır hacim', () => {
    const market = {
      totalVolume: 0,
      bidAskSpread: 0,
      activeTraders: 0,
      lastTradeTime: new Date()
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBe(0)
  })
})
```

## Adım 3: Testleri Çalıştır - Başarısızlığı Doğrula

```bash
npm test lib/liquidity.test.ts

FAIL lib/liquidity.test.ts
  ✕ should return high score for liquid market (2 ms)
    Error: Not implemented

1 test failed, 0 passed
```

PASS: Testler beklendiği gibi başarısız. Uygulamaya hazır.

## Adım 4: Minimal Kod Uygula (GREEN)

```typescript
// lib/liquidity.ts
export function calculateLiquidityScore(market: MarketData): number {
  // Sıfır hacim edge case'ini idare et
  if (market.totalVolume === 0) {
    return 0
  }

  // Bileşen skorlarını hesapla (0-100 ölçeği)
  const volumeScore = Math.min(market.totalVolume / 1000, 100)
  const spreadScore = Math.max(100 - (market.bidAskSpread * 1000), 0)
  const traderScore = Math.min(market.activeTraders / 10, 100)

  // Son aktivite bonusu
  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = Math.max(100 - (hoursSinceLastTrade * 10), 0)

  // Ağırlıklı ortalama
  const score = (
    volumeScore * 0.4 +
    spreadScore * 0.3 +
    traderScore * 0.2 +
    recencyScore * 0.1
  )

  return Math.min(Math.max(score, 0), 100) // 0-100 arası sınırla
}
```

## Adım 5: Testleri Çalıştır - Başarıyı Doğrula

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ should return high score for liquid market (3 ms)
  ✓ should return low score for illiquid market (2 ms)
  ✓ should handle edge case: zero volume (1 ms)

3 tests passed
```

PASS: Tüm testler geçiyor!

## Adım 6: Refactor Et (IYILEŞTIR)

```typescript
// lib/liquidity.ts - Sabitler ve daha iyi okunabilirlik ile refactor edildi
const WEIGHTS = {
  VOLUME: 0.4,
  SPREAD: 0.3,
  TRADERS: 0.2,
  RECENCY: 0.1,
} as const

const SCALE_FACTORS = {
  VOLUME: 1000,
  SPREAD: 1000,
  TRADERS: 10,
  RECENCY_PENALTY: 10,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function calculateLiquidityScore(market: MarketData): number {
  if (market.totalVolume === 0) return 0

  const volumeScore = Math.min(market.totalVolume / SCALE_FACTORS.VOLUME, 100)
  const spreadScore = clamp(100 - (market.bidAskSpread * SCALE_FACTORS.SPREAD), 0, 100)
  const traderScore = Math.min(market.activeTraders / SCALE_FACTORS.TRADERS, 100)

  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = clamp(100 - (hoursSinceLastTrade * SCALE_FACTORS.RECENCY_PENALTY), 0, 100)

  const weightedScore =
    volumeScore * WEIGHTS.VOLUME +
    spreadScore * WEIGHTS.SPREAD +
    traderScore * WEIGHTS.TRADERS +
    recencyScore * WEIGHTS.RECENCY

  return clamp(weightedScore, 0, 100)
}
```

## Adım 7: Testlerin Hala Geçtiğini Doğrula

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ should return high score for liquid market (3 ms)
  ✓ should return low score for illiquid market (2 ms)
  ✓ should handle edge case: zero volume (1 ms)

3 tests passed
```

PASS: Refactoring tamamlandı, testler hala geçiyor!

## Adım 8: Kapsama Oranını Kontrol Et

```bash
npm test -- --coverage lib/liquidity.test.ts

File           | % Stmts | % Branch | % Funcs | % Lines
---------------|---------|----------|---------|--------
liquidity.ts   |   100   |   100    |   100   |   100

Coverage: 100% PASS: (Hedef: 80%)
```

PASS: TDD oturumu tamamlandı!
```

## TDD En İyi Uygulamaları

**YAPIN:**
- PASS: Herhangi bir uygulamadan ÖNCE testi yazın
- PASS: Testleri çalıştırın ve uygulamadan önce başarısız olduklarını doğrulayın
- PASS: Testleri geçirmek için minimal kod yazın
- PASS: Testler yeşil olduktan sonra refactor edin
- PASS: Edge case'leri ve hata senaryolarını ekleyin
- PASS: %80+ kapsama hedefleyin (kritik kod için %100)

**YAPMAYIN:**
- FAIL: Testlerden önce uygulama yazmayın
- FAIL: Her değişiklikten sonra testleri çalıştırmayı atlamayın
- FAIL: Aynı anda çok fazla kod yazmayın
- FAIL: Başarısız testleri görmezden gelmeyin
- FAIL: Uygulama detaylarını test etmeyin (davranışı test edin)
- FAIL: Her şeyi mock'lamayın (integration testleri tercih edin)

## Dahil Edilecek Test Türleri

**Unit Tests** (Fonksiyon seviyesi):
- Happy path senaryoları
- Edge case'ler (boş, null, maksimum değerler)
- Hata koşulları
- Sınır değerleri

**Integration Tests** (Component seviyesi):
- API endpoint'leri
- Database operasyonları
- Dış servis çağrıları
- Hook'lu React componentleri

**E2E Tests** (`/e2e` komutunu kullanın):
- Kritik kullanıcı akışları
- Çok adımlı süreçler
- Full stack entegrasyon

## Kapsama Gereksinimleri

- **Minimum %80** tüm kod için
- **%100 gerekli**:
  - Finansal hesaplamalar
  - Kimlik doğrulama mantığı
  - Güvenlik açısından kritik kod
  - Temel iş mantığı

## Önemli Notlar

**ZORUNLU**: Testler uygulamadan ÖNCE yazılmalıdır. TDD döngüsü:

1. **RED** - Başarısız test yaz
2. **GREEN** - Geçmek için uygula
3. **REFACTOR** - Kodu iyileştir

RED aşamasını asla atlamayın. Testlerden önce asla kod yazmayın.

## Diğer Komutlarla Entegrasyon

- Ne inşa edileceğini anlamak için önce `/plan` kullanın
- Testlerle uygulamak için `/tdd` kullanın
- Build hataları oluşursa `/build-fix` kullanın
- Uygulamayı gözden geçirmek için `/code-review` kullanın
- Kapsama oranını doğrulamak için `/test-coverage` kullanın

## İlgili Agent'lar

Bu komut, ECC tarafından sağlanan `tdd-guide` agent'ını çağırır.

İlgili `tdd-workflow` skill'i de ECC ile birlikte gelir.

Manuel kurulumlar için, kaynak dosyalar şurada bulunur:
- `agents/tdd-guide.md`
- `skills/tdd-workflow/SKILL.md`
