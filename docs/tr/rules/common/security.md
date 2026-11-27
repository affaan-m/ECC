# Güvenlik Kuralları

## Zorunlu Güvenlik Kontrolleri

HERHANGİ bir commit'ten önce:
- [ ] Hardcoded secret yok (API anahtarları, şifreler, token'lar)
- [ ] Tüm kullanıcı girdileri validate edildi
- [ ] SQL injection önleme (parametreli sorgular)
- [ ] XSS önleme (sanitize edilmiş HTML)
- [ ] CSRF koruması etkin
- [ ] Authentication/authorization doğrulandı
- [ ] Tüm endpoint'lerde rate limiting
- [ ] Hata mesajları hassas veri sızdırmıyor

## Secret Yönetimi

- Kaynak kodda ASLA secret'ları hardcode etme
- DAIMA environment variable'lar veya secret manager kullan
- Başlangıçta gerekli secret'ların mevcut olduğunu validate et
- İfşa olmuş olabilecek secret'ları rotate et

## Güvenlik Yanıt Protokolü

Güvenlik sorunu bulunursa:
1. HEMEN DUR
2. **security-reviewer** agent kullan
3. Devam etmeden önce CRITICAL sorunları düzelt
4. İfşa olmuş secret'ları rotate et
5. Benzer sorunlar için tüm kod tabanını incele
