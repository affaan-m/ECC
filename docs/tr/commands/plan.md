---
description: Gereksinimleri yeniden ifade et, riskleri değerlendir ve adım adım uygulama planı oluştur. Herhangi bir koda dokunmadan önce kullanıcı ONAYINI BEKLE.
---

# Plan Komutu

Bu komut, herhangi bir kod yazmadan önce kapsamlı bir uygulama planı oluşturmak için **planner** agent'ını çağırır.

## Bu Komut Ne Yapar

1. **Gereksinimleri Yeniden İfade Et** - Neyin inşa edilmesi gerektiğini netleştir
2. **Riskleri Tanımla** - Potansiyel sorunları ve engelleri ortaya çıkar
3. **Adım Planı Oluştur** - Uygulamayı fazlara ayır
4. **Onay Bekle** - İlerlemeden önce kullanıcı onayı alınmalıdır

## Ne Zaman Kullanılır

`/plan` komutunu şu durumlarda kullanın:
- Yeni bir özelliğe başlarken
- Önemli mimari değişiklikler yaparken
- Karmaşık refactoring üzerinde çalışırken
- Birden fazla dosya/component etkilenecekken
- Gereksinimler belirsiz veya muğlak olduğunda

## Nasıl Çalışır

Planner agent'ı şunları yapacaktır:

1. İsteği **analiz edecek** ve gereksinimleri net şekilde yeniden ifade edecek
2. Belirli, uygulanabilir adımlarla **fazlara ayıracak**
3. Componentler arası **bağımlılıkları tanımlayacak**
4. **Riskleri değerlendirecek** ve potansiyel engelleri belirleyecek
5. **Karmaşıklığı tahmin edecek** (Yüksek/Orta/Düşük)
6. **Planı sunacak** ve açık onayınızı bekleyecek

## Örnek Kullanım

```
Kullanıcı: /plan Piyasalar çözüldüğünde gerçek zamanlı bildirimler eklemeye ihtiyacım var

Agent (planner):
# Uygulama Planı: Gerçek Zamanlı Piyasa Çözüm Bildirimleri

## Gereksinim Yeniden İfadesi
- Kullanıcılar takip ettikleri piyasalar çözüldüğünde bildirim alsın
- Birden fazla bildirim kanalını destekle (uygulama içi, e-posta, webhook)
- Bildirimlerin güvenilir bir şekilde iletilmesini sağla
- Piyasa sonucunu ve kullanıcının pozisyon sonucunu içer

## Uygulama Fazları

### Faz 1: Database Şeması
- Kolonlarla bildirimler tablosu ekle: id, user_id, market_id, type, status, created_at
- Kanal tercihleri için user_notification_preferences tablosu ekle
- Performans için user_id ve market_id üzerinde indexler oluştur

### Faz 2: Bildirim Servisi
- lib/notifications.ts'de bildirim servisi oluştur
- BullMQ/Redis kullanarak bildirim kuyruğu uygula
- Başarısız teslimatlar için yeniden deneme mantığı ekle
- Bildirim şablonları oluştur

### Faz 3: Entegrasyon Noktaları
- Piyasa çözüm mantığına bağlan (durum "resolved" olduğunda)
- Piyasada pozisyonu olan tüm kullanıcıları sorgula
- Her kullanıcı için bildirimleri kuyruğa ekle

### Faz 4: Frontend Componentleri
- Header'da NotificationBell componenti oluştur
- NotificationList modal'ı ekle
- Supabase subscriptions ile gerçek zamanlı güncellemeler uygula
- Bildirim tercihleri sayfası ekle

## Bağımlılıklar
- Redis (kuyruk için)
- E-posta servisi (SendGrid/Resend)
- Supabase real-time subscriptions

## Riskler
- YÜKSEK: E-posta teslimatı (SPF/DKIM gerekli)
- ORTA: Piyasa başına 1000+ kullanıcı ile performans
- ORTA: Piyasalar sık çözülürse bildirim spam'i
- DÜŞÜK: Real-time subscription yükü

## Tahmini Karmaşıklık: ORTA
- Backend: 4-6 saat
- Frontend: 3-4 saat
- Test: 2-3 saat
- Toplam: 9-13 saat

**ONAY BEKLENİYOR**: Bu planla ilerleyelim mi? (evet/hayır/değiştir)
```

## Önemli Notlar

**KRİTİK**: Planner agent, planı "evet" veya "ilerle" veya benzeri olumlu bir yanıtla açıkça onaylayana kadar herhangi bir kod **YAZMAYACAK**.

Değişiklik istiyorsanız, şu şekilde yanıt verin:
- "değiştir: [değişiklikleriniz]"
- "farklı yaklaşım: [alternatif]"
- "faz 2'yi atla ve önce faz 3'ü yap"

## Diğer Komutlarla Entegrasyon

Planlamadan sonra:
- Test odaklı geliştirme ile uygulamak için `/tdd` kullanın
- Build hataları oluşursa `/build-fix` kullanın
- Tamamlanan uygulamayı gözden geçirmek için `/code-review` kullanın

## İlgili Agent'lar

Bu komut, ECC tarafından sağlanan `planner` agent'ını çağırır.

Manuel kurulumlar için, kaynak dosya şurada bulunur:
`agents/planner.md`
