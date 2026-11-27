# Yaygın Pattern'ler

## Skeleton Projeler

Yeni fonksiyonellik uygulanırken:
1. Test edilmiş skeleton projeler ara
2. Seçenekleri değerlendirmek için paralel agent'lar kullan:
   - Güvenlik değerlendirmesi
   - Genişletilebilirlik analizi
   - İlgililik puanlaması
   - Uygulama planlaması
3. En iyi eşleşmeyi temel olarak klonla
4. Kanıtlanmış yapı içinde iterate et

## Tasarım Pattern'leri

### Repository Pattern

Veri erişimini tutarlı bir arayüz arkasında kapsülle:
- Standart işlemleri tanımla: findAll, findById, create, update, delete
- Concrete implementasyonlar storage detaylarını ele alır (database, API, file, vb.)
- Business logic storage mekanizması yerine abstract interface'e bağlıdır
- Veri kaynaklarının kolay değiştirilmesini sağlar ve mock'larla testi basitleştirir

### API Response Formatı

Tüm API yanıtları için tutarlı bir zarf kullan:
- Success/status göstergesi ekle
- Data payload ekle (hata durumunda nullable)
- Hata mesajı alanı ekle (başarı durumunda nullable)
- Sayfalandırılmış yanıtlar için metadata ekle (total, page, limit)
