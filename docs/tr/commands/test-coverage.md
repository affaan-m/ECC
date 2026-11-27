# Test Coverage

Test coverage'ını analiz et, eksiklikleri tanımla ve 80%+ coverage'a ulaşmak için eksik test'leri oluştur.

## Adım 1: Test Framework'ünü Tespit Et

| Gösterge | Coverage Komutu |
|-----------|-----------------|
| `jest.config.*` veya `package.json` jest | `npx jest --coverage --coverageReporters=json-summary` |
| `vitest.config.*` | `npx vitest run --coverage` |
| `pytest.ini` / `pyproject.toml` pytest | `pytest --cov=src --cov-report=json` |
| `Cargo.toml` | `cargo llvm-cov --json` |
| `pom.xml` JaCoCo ile | `mvn test jacoco:report` |
| `go.mod` | `go test -coverprofile=coverage.out ./...` |

## Adım 2: Coverage Raporunu Analiz Et

1. Coverage komutunu çalıştır
2. Çıktıyı ayrıştır (JSON summary veya terminal çıktısı)
3. **80% coverage'ın altındaki** dosyaları listele, en kötüden başlayarak sırala
4. Her yetersiz coverage'lı dosya için şunları tanımla:
   - Test edilmemiş fonksiyonlar veya metodlar
   - Eksik branch coverage (if/else, switch, error yolları)
   - Payda'yı şişiren dead code

## Adım 3: Eksik Test'leri Oluştur

Her yetersiz coverage'lı dosya için, bu önceliği takip ederek test'ler oluştur:

1. **Happy path** — Geçerli input'larla temel fonksiyonalite
2. **Hata işleme** — Geçersiz input'lar, eksik veri, network hataları
3. **Edge case'ler** — Boş diziler, null/undefined, sınır değerleri (0, -1, MAX_INT)
4. **Branch coverage** — Her if/else, switch case, ternary

### Test Oluşturma Kuralları

- Test'leri kaynak kodun yanına yerleştir: `foo.ts` → `foo.test.ts` (veya proje konvansiyonu)
- Projeden mevcut test pattern'lerini kullan (import stili, assertion kütüphanesi, mocking yaklaşımı)
- Harici bağımlılıkları mock'la (veritabanı, API'ler, dosya sistemi)
- Her test bağımsız olmalı — test'ler arasında paylaşılan değişken state olmamalı
- Test'leri açıklayıcı isimlendirin: `test_create_user_with_duplicate_email_returns_409`

## Adım 4: Doğrula

1. Tam test suite'ini çalıştır — tüm test'ler geçmeli
2. Coverage'ı yeniden çalıştır — iyileşmeyi doğrula
3. Hala 80%'in altındaysa, kalan boşluklar için Adım 3'ü tekrarla

## Adım 5: Raporla

Öncesi/sonrası karşılaştırmasını göster:

```
Coverage Report
──────────────────────────────
File                   Before  After
src/services/auth.ts   45%     88%
src/utils/validation.ts 32%    82%
──────────────────────────────
Overall:               67%     84%  PASS:
```

## Odak Alanları

- Karmaşık branching'e sahip fonksiyonlar (yüksek cyclomatic complexity)
- Hata işleyiciler ve catch blokları
- Codebase genelinde kullanılan utility fonksiyonları
- API endpoint handler'ları (request → response akışı)
- Edge case'ler: null, undefined, empty string, empty array, zero, negatif sayılar
