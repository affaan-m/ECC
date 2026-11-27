---
description: Playwright ile end-to-end testler oluştur ve çalıştır. Test yolculukları oluşturur, testleri çalıştırır, ekran görüntüleri/videolar/izlemeler yakalar ve artifact'ları yükler.
---

# E2E Komutu

Bu komut, Playwright kullanarak end-to-end testleri oluşturmak, sürdürmek ve yürütmek için **e2e-runner** agent'ını çağırır.

## Bu Komut Ne Yapar

1. **Test Yolculukları Oluştur** - Kullanıcı akışları için Playwright testleri oluştur
2. **E2E Testlerini Çalıştır** - Testleri tarayıcılar arasında yürüt
3. **Artifact'ları Yakala** - Hatalarda ekran görüntüleri, videolar, izlemeler
4. **Sonuçları Yükle** - HTML raporları ve JUnit XML
5. **Dengesiz Testleri Tanımla** - Kararsız testleri karantinaya al

## Ne Zaman Kullanılır

`/e2e` komutunu şu durumlarda kullanın:
- Kritik kullanıcı yolculuklarını test ederken (giriş, ticaret, ödemeler)
- Çok adımlı akışların uçtan uca çalıştığını doğrularken
- UI etkileşimlerini ve navigasyonu test ederken
- Frontend ve backend arasındaki entegrasyonu doğrularken
- Üretime dağıtım için hazırlanırken

## Nasıl Çalışır

e2e-runner agent'ı şunları yapacaktır:

1. **Kullanıcı akışını analiz edecek** ve test senaryolarını tanımlayacak
2. Page Object Model deseni kullanarak **Playwright testi oluşturacak**
3. **Testleri çalıştıracak** (Chrome, Firefox, Safari)
4. Ekran görüntüleri, videolar ve izlemelerle **hataları yakalayacak**
5. Sonuçlar ve artifact'larla **rapor oluşturacak**
6. **Dengesiz testleri tanımlayacak** ve düzeltme önerilerinde bulunacak

## Örnek Kullanım

```
Kullanıcı: /e2e Piyasa arama ve görüntüleme akışını test et

Agent (e2e-runner):
# E2E Test Oluşturma: Piyasa Arama ve Görüntüleme Akışı

## Tanımlanan Test Senaryosu

**Kullanıcı Yolculuğu:** Piyasa Arama → Sonuçları Görüntüle → Piyasaya Tıkla → Detayları Görüntüle

**Test Kapsamı:**
1. Piyasalar sayfasına git
2. Semantik arama yap
3. Arama sonuçlarını doğrula
4. İlk sonuca tıkla
5. Piyasa detay sayfasının yüklendiğini doğrula
6. Grafiğin render olduğunu doğrula

## Oluşturulan Test Kodu

```typescript
// tests/e2e/markets/search-and-view.spec.ts
import { test, expect } from '@playwright/test'
import { MarketsPage } from '../../pages/MarketsPage'
import { MarketDetailsPage } from '../../pages/MarketDetailsPage'

test.describe('Market Search and View Flow', () => {
  test('kullanıcı piyasaları arayabilir ve detayları görüntüleyebilir', async ({ page }) => {
    // 1. Piyasalar sayfasına git
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Sayfanın yüklendiğini doğrula
    await expect(page).toHaveTitle(/Markets/)
    await expect(page.locator('h1')).toContainText('Markets')

    // 2. Semantik arama yap
    await marketsPage.searchMarkets('election')

    // API yanıtını bekle
    await page.waitForResponse(resp =>
      resp.url().includes('/api/markets/search') && resp.status() === 200
    )

    // 3. Arama sonuçlarını doğrula
    const marketCards = marketsPage.marketCards
    await expect(marketCards.first()).toBeVisible()
    const resultCount = await marketCards.count()
    expect(resultCount).toBeGreaterThan(0)

    // Arama sonuçlarının ekran görüntüsünü al
    await page.screenshot({ path: 'artifacts/search-results.png' })

    // 4. İlk sonuca tıkla
    const firstMarketTitle = await marketCards.first().textContent()
    await marketCards.first().click()

    // 5. Piyasa detay sayfasının yüklendiğini doğrula
    await expect(page).toHaveURL(/\/markets\/[a-z0-9-]+/)

    const detailsPage = new MarketDetailsPage(page)
    await expect(detailsPage.marketName).toBeVisible()
    await expect(detailsPage.marketDescription).toBeVisible()

    // 6. Grafiğin render olduğunu doğrula
    await expect(detailsPage.priceChart).toBeVisible()

    // Piyasa adının eşleştiğini doğrula
    const detailsTitle = await detailsPage.marketName.textContent()
    expect(detailsTitle?.toLowerCase()).toContain(
      firstMarketTitle?.toLowerCase().substring(0, 20) || ''
    )

    // Piyasa detaylarının ekran görüntüsünü al
    await page.screenshot({ path: 'artifacts/market-details.png' })
  })

  test('sonuç olmayan arama boş durumu göstermeli', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Var olmayan piyasayı ara
    await marketsPage.searchMarkets('xyznonexistentmarket123456')

    // Boş durumu doğrula
    await expect(page.locator('[data-testid="no-results"]')).toBeVisible()
    await expect(page.locator('[data-testid="no-results"]')).toContainText(
      /no.*results|no.*markets/i
    )

    const marketCount = await marketsPage.marketCards.count()
    expect(marketCount).toBe(0)
  })

  test('aramayı temizleyebilir ve tüm piyasaları tekrar görebilir', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // İlk piyasa sayısı
    const initialCount = await marketsPage.marketCards.count()

    // Arama yap
    await marketsPage.searchMarkets('trump')
    await page.waitForLoadState('networkidle')

    // Filtrelenmiş sonuçları doğrula
    const filteredCount = await marketsPage.marketCards.count()
    expect(filteredCount).toBeLessThan(initialCount)

    // Aramayı temizle
    await marketsPage.searchInput.clear()
    await page.waitForLoadState('networkidle')

    // Tüm piyasaların tekrar gösterildiğini doğrula
    const finalCount = await marketsPage.marketCards.count()
    expect(finalCount).toBe(initialCount)
  })
})
```

## Testleri Çalıştırma

```bash
# Oluşturulan testi çalıştır
npx playwright test tests/e2e/markets/search-and-view.spec.ts

3 worker kullanarak 3 test çalıştırılıyor

  ✓  [chromium] › search-and-view.spec.ts:5:3 › user can search markets and view details (4.2s)
  ✓  [chromium] › search-and-view.spec.ts:52:3 › search with no results shows empty state (1.8s)
  ✓  [chromium] › search-and-view.spec.ts:67:3 › can clear search and see all markets again (2.9s)

  3 passed (9.1s)

Oluşturulan artifact'lar:
- artifacts/search-results.png
- artifacts/market-details.png
- playwright-report/index.html
```

## Test Raporu

```
╔══════════════════════════════════════════════════════════════╗
║                    E2E Test Sonuçları                        ║
╠══════════════════════════════════════════════════════════════╣
║ Durum:      PASS: TÜM TESTLER GEÇTİ                             ║
║ Toplam:     3 test                                           ║
║ Geçti:      3 (%100)                                         ║
║ Başarısız:  0                                                ║
║ Dengesiz:   0                                                ║
║ Süre:       9.1s                                             ║
╚══════════════════════════════════════════════════════════════╝

Artifact'lar:
 Ekran Görüntüleri: 2 dosya
 Videolar: 0 dosya (sadece hatada)
 İzlemeler: 0 dosya (sadece hatada)
 HTML Rapor: playwright-report/index.html

Raporu görüntüle: npx playwright show-report
```

PASS: E2E test paketi CI/CD entegrasyonuna hazır!
```

## Test Artifact'ları

Testler çalıştığında, şu artifact'lar yakalanır:

**Tüm Testlerde:**
- Zaman çizelgesi ve sonuçlarla HTML Rapor
- CI entegrasyonu için JUnit XML

**Sadece Hatada:**
- Başarısız durumun ekran görüntüsü
- Testin video kaydı
- Hata ayıklama için izleme dosyası (adım adım tekrar)
- Network logları
- Console logları

## Artifact'ları Görüntüleme

```bash
# HTML raporunu tarayıcıda görüntüle
npx playwright show-report

# Belirli izleme dosyasını görüntüle
npx playwright show-trace artifacts/trace-abc123.zip

# Ekran görüntüleri artifacts/ dizinine kaydedilir
open artifacts/search-results.png
```

## Dengesiz Test Tespiti

Bir test aralıklı olarak başarısız olursa:

```
WARNING:  DENGESİZ TEST TESPİT EDİLDİ: tests/e2e/markets/trade.spec.ts

Test 10 çalıştırmadan 7'sinde geçti (%70 geçme oranı)

Yaygın başarısızlık:
"'[data-testid="confirm-btn"]' elementi için timeout"

Önerilen düzeltmeler:
1. Açık bekleme ekle: await page.waitForSelector('[data-testid="confirm-btn"]')
2. Timeout'u artır: { timeout: 10000 }
3. Component'te yarış koşullarını kontrol et
4. Elementin animasyon tarafından gizlenmediğini doğrula

Karantina önerisi: Düzeltilene kadar test.fixme() olarak işaretle
```

## Tarayıcı Yapılandırması

Testler varsayılan olarak birden fazla tarayıcıda çalışır:
- PASS: Chromium (Desktop Chrome)
- PASS: Firefox (Desktop)
- PASS: WebKit (Desktop Safari)
- PASS: Mobile Chrome (opsiyonel)

Tarayıcıları ayarlamak için `playwright.config.ts`'yi yapılandırın.

## CI/CD Entegrasyonu

CI pipeline'ınıza ekleyin:

```yaml
# .github/workflows/e2e.yml
- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npx playwright test

- name: Upload artifacts
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## PMX'e Özgü Kritik Akışlar

PMX için bu E2E testlerine öncelik verin:

**KRİTİK (Her Zaman Geçmeli):**
1. Kullanıcı cüzdan bağlayabilir
2. Kullanıcı piyasalara göz atabilir
3. Kullanıcı piyasa arayabilir (semantik arama)
4. Kullanıcı piyasa detaylarını görüntüleyebilir
5. Kullanıcı işlem yapabilir (test fonlarıyla)
6. Piyasa doğru çözülür
7. Kullanıcı fon çekebilir

**ÖNEMLİ:**
1. Piyasa oluşturma akışı
2. Kullanıcı profil güncellemeleri
3. Gerçek zamanlı fiyat güncellemeleri
4. Grafik render'ı
5. Piyasaları filtreleme ve sıralama
6. Mobil responsive layout

## En İyi Uygulamalar

**YAPIN:**
- PASS: Sürdürülebilirlik için Page Object Model kullanın
- PASS: Selector'lar için data-testid nitelikleri kullanın
- PASS: Rastgele timeout'lar değil, API yanıtlarını bekleyin
- PASS: Kritik kullanıcı yolculuklarını uçtan uca test edin
- PASS: Main'e merge etmeden önce testleri çalıştırın
- PASS: Testler başarısız olduğunda artifact'ları inceleyin

**YAPMAYIN:**
- FAIL: Kırılgan selector'lar kullanmayın (CSS sınıfları değişebilir)
- FAIL: Uygulama detaylarını test etmeyin
- FAIL: Production'a karşı testler çalıştırmayın
- FAIL: Dengesiz testleri görmezden gelmeyin
- FAIL: Başarısızlıklarda artifact incelemesini atlamayın
- FAIL: Her edge case'i E2E ile test etmeyin (unit testler kullanın)

## Önemli Notlar

**PMX için KRİTİK:**
- Gerçek para içeren E2E testleri SADECE testnet/staging'de çalışmalıdır
- Asla production'a karşı ticaret testleri çalıştırmayın
- Finansal testler için `test.skip(process.env.NODE_ENV === 'production')` ayarlayın
- Sadece küçük test fonlarıyla test cüzdanları kullanın

## Diğer Komutlarla Entegrasyon

- Test edilecek kritik yolculukları tanımlamak için `/plan` kullanın
- Unit testler için `/tdd` kullanın (daha hızlı, daha ayrıntılı)
- Entegrasyon ve kullanıcı yolculuk testleri için `/e2e` kullanın
- Test kalitesini doğrulamak için `/code-review` kullanın

## İlgili Agent'lar

Bu komut, ECC tarafından sağlanan `e2e-runner` agent'ını çağırır.

Manuel kurulumlar için, kaynak dosya şurada bulunur:
`agents/e2e-runner.md`

## Hızlı Komutlar

```bash
# Tüm E2E testlerini çalıştır
npx playwright test

# Belirli test dosyasını çalıştır
npx playwright test tests/e2e/markets/search.spec.ts

# Headed modda çalıştır (tarayıcıyı gör)
npx playwright test --headed

# Testi debug et
npx playwright test --debug

# Test kodu oluştur
npx playwright codegen http://localhost:3000

# Raporu görüntüle
npx playwright show-report
```
