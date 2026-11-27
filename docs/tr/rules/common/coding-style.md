# Kodlama Stili

## Immutability (KRİTİK)

DAIMA yeni nesneler oluştur, mevcut olanları ASLA değiştirme:

```
// Pseudocode
YANLIŞ:  modify(original, field, value) → original'i yerinde değiştirir
DOĞRU: update(original, field, value) → değişiklikle birlikte yeni kopya döner
```

Gerekçe: Immutable veri gizli yan etkileri önler, debug'ı kolaylaştırır ve güvenli eşzamanlılık sağlar.

## Dosya Organizasyonu

ÇOK KÜÇÜK DOSYA > AZ BÜYÜK DOSYA:
- Yüksek kohezyon, düşük coupling
- Tipik 200-400 satır, maksimum 800
- Büyük modüllerden utility'leri çıkar
- Type'a göre değil, feature/domain'e göre organize et

## Hata Yönetimi

Hataları DAIMA kapsamlı bir şekilde yönet:
- Her seviyede hataları açıkça ele al
- UI'ye yönelik kodda kullanıcı dostu hata mesajları ver
- Server tarafında detaylı hata bağlamı logla
- Hataları asla sessizce yutma

## Input Validasyonu

Sistem sınırlarında DAIMA validate et:
- İşlemeden önce tüm kullanıcı girdilerini validate et
- Mümkün olan yerlerde schema tabanlı validasyon kullan
- Açık hata mesajlarıyla hızlıca başarısız ol
- Harici verilere asla güvenme (API yanıtları, kullanıcı girdisi, dosya içeriği)

## Kod Kalitesi Kontrol Listesi

İşi tamamlandı olarak işaretlemeden önce:
- [ ] Kod okunabilir ve iyi adlandırılmış
- [ ] Fonksiyonlar küçük (<50 satır)
- [ ] Dosyalar odaklı (<800 satır)
- [ ] Derin iç içe geçme yok (>4 seviye)
- [ ] Düzgün hata yönetimi
- [ ] Hardcoded değer yok (sabit veya config kullan)
- [ ] Mutasyon yok (immutable pattern'ler kullanıldı)
