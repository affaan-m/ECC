# Code Review

Commit edilmemiş değişikliklerin kapsamlı güvenlik ve kalite incelemesi:

1. Değişen dosyaları al: git diff --name-only HEAD

2. Her değişen dosya için şunları kontrol et:

**Güvenlik Sorunları (KRİTİK):**
- Hardcode edilmiş kimlik bilgileri, API anahtarları, token'lar
- SQL injection açıklıkları
- XSS açıklıkları
- Eksik input validasyonu
- Güvenli olmayan bağımlılıklar
- Path traversal riskleri

**Kod Kalitesi (YÜKSEK):**
- 50 satırdan uzun fonksiyonlar
- 800 satırdan uzun dosyalar
- 4 seviyeden fazla iç içe geçme derinliği
- Eksik hata yönetimi
- console.log ifadeleri
- TODO/FIXME yorumları
- Public API'ler için eksik JSDoc

**En İyi Uygulamalar (ORTA):**
- Mutation desenleri (immutable kullanın)
- Kod/yorumlarda emoji kullanımı
- Yeni kod için eksik testler
- Erişilebilirlik sorunları (a11y)

3. Şunları içeren rapor oluştur:
   - Önem derecesi: KRİTİK, YÜKSEK, ORTA, DÜŞÜK
   - Dosya konumu ve satır numaraları
   - Sorun açıklaması
   - Önerilen düzeltme

4. KRİTİK veya YÜKSEK sorunlar bulunursa commit'i engelle

Güvenlik açıklıkları olan kodu asla onaylamayın!
