# Checkpoint Komutu

İş akışınızda bir checkpoint oluşturun veya doğrulayın.

## Kullanım

`/checkpoint [create|verify|list|clear] [isim]`

## Checkpoint Oluştur

Checkpoint oluştururken:

1. Mevcut durumun temiz olduğundan emin olmak için `/verify quick` çalıştır
2. Checkpoint adıyla bir git stash veya commit oluştur
3. Checkpoint'i `.claude/checkpoints.log`'a kaydet:

```bash
echo "$(date +%Y-%m-%d-%H:%M) | $CHECKPOINT_NAME | $(git rev-parse --short HEAD)" >> .claude/checkpoints.log
```

4. Checkpoint oluşturulduğunu raporla

## Checkpoint'i Doğrula

Bir checkpoint'e karşı doğrularken:

1. Log'dan checkpoint'i oku
2. Mevcut durumu checkpoint ile karşılaştır:
   - Checkpoint'ten sonra eklenen dosyalar
   - Checkpoint'ten sonra değiştirilen dosyalar
   - Şimdiki vs o zamanki test başarı oranı
   - Şimdiki vs o zamanki kapsama oranı

3. Raporla:
```
CHECKPOINT KARŞILAŞTIRMASI: $NAME
============================
Değişen dosyalar: X
Testler: +Y geçti / -Z başarısız
Kapsama: +X% / -Y%
Build: [GEÇTİ/BAŞARISIZ]
```

## Checkpoint'leri Listele

Tüm checkpoint'leri şunlarla göster:
- Ad
- Zaman damgası
- Git SHA
- Durum (mevcut, geride, ileride)

## İş Akışı

Tipik checkpoint akışı:

```
[Başlangıç] --> /checkpoint create "feature-start"
   |
[Uygula] --> /checkpoint create "core-done"
   |
[Test] --> /checkpoint verify "core-done"
   |
[Refactor] --> /checkpoint create "refactor-done"
   |
[PR] --> /checkpoint verify "feature-start"
```

## Argümanlar

$ARGUMENTS:
- `create <isim>` - İsimlendirilmiş checkpoint oluştur
- `verify <isim>` - İsimlendirilmiş checkpoint'e karşı doğrula
- `list` - Tüm checkpoint'leri göster
- `clear` - Eski checkpoint'leri kaldır (son 5'i tutar)
