---
name: tdd-workflow
description: Yeni özellikler yazarken, hata düzeltirken veya kod refactor ederken bu skill'i kullanın. Unit, integration ve E2E testlerini içeren %80+ kapsam ile test güdümlü geliştirmeyi zorlar.
origin: ECC
---

# Test Güdümlü Geliştirme İş Akışı

Bu skill tüm kod geliştirmenin kapsamlı test kapsamı ile TDD ilkelerini takip etmesini sağlar.

## Ne Zaman Aktifleştirmelisiniz

- Yeni özellikler veya fonksiyonellik yazarken
- Hataları veya sorunları düzeltirken
- Mevcut kodu refactor ederken
- API endpoint'leri eklerken
- Yeni bileşenler oluştururken

## Temel İlkeler

### 1. Koddan ÖNCE Testler
HER ZAMAN önce testleri yazın, sonra testleri geçmesi için kod uygulayın.

### 2. Kapsam Gereksinimleri
- Minimum %80 kapsam (unit + integration + E2E)
- Tüm uç durumlar kapsanmış
- Hata senaryoları test edilmiş
- Sınır koşulları doğrulanmış

### 3. Test Tipleri

#### Unit Testler
- Bireysel fonksiyonlar ve yardımcı araçlar
- Bileşen mantığı
- Pure fonksiyonlar
- Yardımcılar ve utilities

#### Integration Testler
- API endpoint'leri
- Veritabanı operasyonları
- Service etkileşimleri
- Harici API çağrıları

#### E2E Testler (Playwright)
- Kritik kullanıcı akışları
- Tam iş akışları
- Tarayıcı otomasyonu
- UI etkileşimleri

## TDD İş Akışı Adımları

### Adım 1: Kullanıcı Hikayeleri Yazın
```
[Rol] olarak, [eylem] yapmak istiyorum, böylece [fayda] elde ederim

Örnek:
Kullanıcı olarak, marketleri semantik olarak aramak istiyorum,
böylece tam anahtar kelimeler olmasa bile ilgili marketleri bulabilirim.
```

### Adım 2: Test Senaryoları Oluşturun
Her kullanıcı hikayesi için kapsamlı test senaryoları oluşturun:

```typescript
describe('Semantik Arama', () => {
  it('sorgu için ilgili marketleri döndürür', async () => {
    // Test implementasyonu
  })

  it('boş sorguyu zarif şekilde işler', async () => {
    // Uç durumu test et
  })

  it('Redis kullanılamazsa substring aramaya geri döner', async () => {
    // Fallback davranışını test et
  })

  it('sonuçları benzerlik skoruna göre sıralar', async () => {
    // Sıralama mantığını test et
  })
})
```

### Adım 3: Testleri Çalıştırın (Başarısız Olmalı)
```bash
npm test
# Testler başarısız olmalı - henüz implement etmedik
```

### Adım 4: Kod Uygulayın
Testleri geçmesi için minimal kod yazın:

```typescript
// Testler tarafından yönlendirilen implementasyon
export async function searchMarkets(query: string) {
  // Implementasyon buraya
}
```

### Adım 5: Testleri Tekrar Çalıştırın
```bash
npm test
# Testler artık geçmeli
```

### Adım 6: Refactor Edin
Testleri yeşil tutarken kod kalitesini iyileştirin:
- Tekrarı kaldırın
- İsimlendirmeyi iyileştirin
- Performansı optimize edin
- Okunabilirliği artırın

### Adım 7: Kapsamı Doğrulayın
```bash
npm run test:coverage
# %80+ kapsam sağlandığını doğrula
```

## Test Kalıpları

### Unit Test Kalıbı (Jest/Vitest)
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './Button'

describe('Button Bileşeni', () => {
  it('doğru metinle render eder', () => {
    render(<Button>Tıkla</Button>)
    expect(screen.getByText('Tıkla')).toBeInTheDocument()
  })

  it('tıklandığında onClick\'i çağırır', () => {
    const handleClick = jest.fn()
    render(<Button onClick={handleClick}>Tıkla</Button>)

    fireEvent.click(screen.getByRole('button'))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('disabled prop true olduğunda devre dışı kalır', () => {
    render(<Button disabled>Tıkla</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
```

### API Integration Test Kalıbı
```typescript
import { NextRequest } from 'next/server'
import { GET } from './route'

describe('GET /api/markets', () => {
  it('marketleri başarıyla döndürür', async () => {
    const request = new NextRequest('http://localhost/api/markets')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(Array.isArray(data.data)).toBe(true)
  })

  it('query parametrelerini validate eder', async () => {
    const request = new NextRequest('http://localhost/api/markets?limit=invalid')
    const response = await GET(request)

    expect(response.status).toBe(400)
  })

  it('veritabanı hatalarını zarif şekilde işler', async () => {
    // Veritabanı başarısızlığını mock'la
    const request = new NextRequest('http://localhost/api/markets')
    // Hata işlemeyi test et
  })
})
```

### E2E Test Kalıbı (Playwright)
```typescript
import { test, expect } from '@playwright/test'

test('kullanıcı marketleri arayabilir ve filtreleyebilir', async ({ page }) => {
  // Markets sayfasına git
  await page.goto('/')
  await page.click('a[href="/markets"]')

  // Sayfanın yüklendiğini doğrula
  await expect(page.locator('h1')).toContainText('Markets')

  // Marketleri ara
  await page.fill('input[placeholder="Marketleri ara"]', 'election')

  // Debounce ve sonuçları bekle
  await page.waitForTimeout(600)

  // Arama sonuçlarının gösterildiğini doğrula
  const results = page.locator('[data-testid="market-card"]')
  await expect(results).toHaveCount(5, { timeout: 5000 })

  // Sonuçların arama terimini içerdiğini doğrula
  const firstResult = results.first()
  await expect(firstResult).toContainText('election', { ignoreCase: true })

  // Duruma göre filtrele
  await page.click('button:has-text("Aktif")')

  // Filtrelenmiş sonuçları doğrula
  await expect(results).toHaveCount(3)
})

test('kullanıcı yeni market oluşturabilir', async ({ page }) => {
  // Önce login ol
  await page.goto('/creator-dashboard')

  // Market oluşturma formunu doldur
  await page.fill('input[name="name"]', 'Test Market')
  await page.fill('textarea[name="description"]', 'Test açıklama')
  await page.fill('input[name="endDate"]', '2025-12-31')

  // Formu gönder
  await page.click('button[type="submit"]')

  // Başarı mesajını doğrula
  await expect(page.locator('text=Market başarıyla oluşturuldu')).toBeVisible()

  // Market sayfasına yönlendirmeyi doğrula
  await expect(page).toHaveURL(/\/markets\/test-market/)
})
```

## Test Dosya Organizasyonu

```
src/
├── components/
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx          # Unit testler
│   │   └── Button.stories.tsx       # Storybook
│   └── MarketCard/
│       ├── MarketCard.tsx
│       └── MarketCard.test.tsx
├── app/
│   └── api/
│       └── markets/
│           ├── route.ts
│           └── route.test.ts         # Integration testler
└── e2e/
    ├── markets.spec.ts               # E2E testler
    ├── trading.spec.ts
    └── auth.spec.ts
```

## Harici Servisleri Mock'lama

### Supabase Mock
```typescript
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({
          data: [{ id: 1, name: 'Test Market' }],
          error: null
        }))
      }))
    }))
  }
}))
```

### Redis Mock
```typescript
jest.mock('@/lib/redis', () => ({
  searchMarketsByVector: jest.fn(() => Promise.resolve([
    { slug: 'test-market', similarity_score: 0.95 }
  ])),
  checkRedisHealth: jest.fn(() => Promise.resolve({ connected: true }))
}))
```

### OpenAI Mock
```typescript
jest.mock('@/lib/openai', () => ({
  generateEmbedding: jest.fn(() => Promise.resolve(
    new Array(1536).fill(0.1) // Mock 1536-boyutlu embedding
  ))
}))
```

## Test Kapsamı Doğrulama

### Kapsam Raporu Çalıştır
```bash
npm run test:coverage
```

### Kapsam Eşikleri
```json
{
  "jest": {
    "coverageThresholds": {
      "global": {
        "branches": 80,
        "functions": 80,
        "lines": 80,
        "statements": 80
      }
    }
  }
}
```

## Kaçınılması Gereken Yaygın Test Hataları

### FAIL: YANLIŞ: Implementasyon Detaylarını Test Etme
```typescript
// İç state'i test etme
expect(component.state.count).toBe(5)
```

### PASS: DOĞRU: Kullanıcı Tarafından Görünen Davranışı Test Et
```typescript
// Kullanıcıların gördüğünü test et
expect(screen.getByText('Sayı: 5')).toBeInTheDocument()
```

### FAIL: YANLIŞ: Kırılgan Selector'lar
```typescript
// Kolayca bozulur
await page.click('.css-class-xyz')
```

### PASS: DOĞRU: Semantik Selector'lar
```typescript
// Değişikliklere karşı dayanıklı
await page.click('button:has-text("Gönder")')
await page.click('[data-testid="submit-button"]')
```

### FAIL: YANLIŞ: Test İzolasyonu Yok
```typescript
// Testler birbirine bağımlı
test('kullanıcı oluşturur', () => { /* ... */ })
test('aynı kullanıcıyı günceller', () => { /* önceki teste bağımlı */ })
```

### PASS: DOĞRU: Bağımsız Testler
```typescript
// Her test kendi verisini hazırlar
test('kullanıcı oluşturur', () => {
  const user = createTestUser()
  // Test mantığı
})

test('kullanıcı günceller', () => {
  const user = createTestUser()
  // Güncelleme mantığı
})
```

## Sürekli Test

### Geliştirme Sırasında Watch Modu
```bash
npm test -- --watch
# Dosya değişikliklerinde testler otomatik çalışır
```

### Pre-Commit Hook
```bash
# Her commit öncesi çalışır
npm test && npm run lint
```

### CI/CD Entegrasyonu
```yaml
# GitHub Actions
- name: Run Tests
  run: npm test -- --coverage
- name: Upload Coverage
  uses: codecov/codecov-action@v3
```

## En İyi Uygulamalar

1. **Önce Testleri Yaz** - Her zaman TDD
2. **Test Başına Bir Assert** - Tek davranışa odaklan
3. **Açıklayıcı Test İsimleri** - Neyin test edildiğini açıkla
4. **Arrange-Act-Assert** - Net test yapısı
5. **Harici Bağımlılıkları Mock'la** - Unit testleri izole et
6. **Uç Durumları Test Et** - Null, undefined, boş, büyük
7. **Hata Yollarını Test Et** - Sadece happy path değil
8. **Testleri Hızlı Tut** - Unit testler < 50ms her biri
9. **Testlerden Sonra Temizle** - Yan etki yok
10. **Kapsam Raporlarını İncele** - Boşlukları tespit et

## Başarı Metrikleri

- %80+ kod kapsamı sağlanmış
- Tüm testler geçiyor (yeşil)
- Atlanmış veya devre dışı test yok
- Hızlı test yürütme (< 30s unit testler için)
- E2E testler kritik kullanıcı akışlarını kapsıyor
- Testler production'dan önce hataları yakalar

---

**Unutmayın**: Testler opsiyonel değildir. Güvenli refactoring, hızlı geliştirme ve production güvenilirliği sağlayan güvenlik ağıdırlar.
