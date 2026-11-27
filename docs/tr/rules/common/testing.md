# Test Gereksinimleri

## Minimum Test Coverage: %80

Test Tipleri (HEPSİ gerekli):
1. **Unit Tests** - Bireysel fonksiyonlar, utility'ler, component'ler
2. **Integration Tests** - API endpoint'leri, database işlemleri
3. **E2E Tests** - Kritik kullanıcı akışları (framework dile göre seçilir)

## Test Odaklı Geliştirme

ZORUNLU iş akışı:
1. Önce test yaz (RED)
2. Testi çalıştır - BAŞARISIZ olmalı
3. Minimum implementasyon yaz (GREEN)
4. Testi çalıştır - BAŞARILI olmalı
5. Refactor et (IMPROVE)
6. Coverage'ı doğrula (%80+)

## Test Hatalarında Sorun Giderme

1. **tdd-guide** agent kullan
2. Test izolasyonunu kontrol et
3. Mock'ların doğru olduğunu doğrula
4. Testleri değil implementasyonu düzelt (testler yanlış olmadıkça)

## Agent Desteği

- **tdd-guide** - Yeni özellikler için PROAKTİF olarak kullan, test-önce-yaz'ı zorlar
