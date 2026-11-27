# Refactor Clean

Her adımda test doğrulaması ile ölü kodu güvenle tanımla ve kaldır.

## Adım 1: Ölü Kodu Tespit Et

Proje türüne göre analiz araçlarını çalıştır:

| Araç | Ne Bulur | Komut |
|------|--------------|---------|
| knip | Kullanılmayan export'lar, dosyalar, bağımlılıklar | `npx knip` |
| depcheck | Kullanılmayan npm bağımlılıkları | `npx depcheck` |
| ts-prune | Kullanılmayan TypeScript export'ları | `npx ts-prune` |
| vulture | Kullanılmayan Python kodu | `vulture src/` |
| deadcode | Kullanılmayan Go kodu | `deadcode ./...` |
| cargo-udeps | Kullanılmayan Rust bağımlılıkları | `cargo +nightly udeps` |

Hiçbir araç yoksa, sıfır import'lu export'ları bulmak için Grep kullanın:
```
# Export'ları bul, sonra herhangi bir yerde import edilip edilmediklerini kontrol et
```

## Adım 2: Bulguları Kategorize Et

Bulguları güvenlik katmanlarına göre sırala:

| Katman | Örnekler | Aksiyon |
|------|----------|--------|
| **GÜVENLİ** | Kullanılmayan yardımcılar, test yardımcıları, dahili fonksiyonlar | Güvenle sil |
| **DİKKAT** | Component'ler, API route'ları, middleware | Dinamik import'ları veya harici tüketicileri olmadığını doğrula |
| **TEHLİKE** | Config dosyaları, giriş noktaları, tip tanımları | Dokunmadan önce araştır |

## Adım 3: Güvenli Silme Döngüsü

Her GÜVENLİ öğe için:

1. **Tam test paketini çalıştır** — Baseline oluştur (tümü yeşil)
2. **Ölü kodu sil** — Cerrahi kaldırma için Edit aracını kullan
3. **Test paketini yeniden çalıştır** — Hiçbir şeyin bozulmadığını doğrula
4. **Testler başarısız olursa** — Hemen `git checkout -- <file>` ile geri al ve bu öğeyi atla
5. **Testler geçerse** — Sonraki öğeye geç

## Adım 4: DİKKAT Öğelerini İdare Et

DİKKAT öğelerini silmeden önce:
- Dinamik import'ları ara: `import()`, `require()`, `__import__`
- String referansları ara: route isimleri, config'lerdeki component isimleri
- Public paket API'sinden export edilip edilmediğini kontrol et
- Harici tüketici olmadığını doğrula (yayınlanmışsa bağımlıları kontrol et)

## Adım 5: Duplikatları Birleştir

Ölü kodu kaldırdıktan sonra şunları ara:
- Neredeyse aynı fonksiyonlar (%80'den fazla benzer) — birinde birleştir
- Gereksiz tip tanımları — birleştir
- Değer eklemeyen wrapper fonksiyonlar — inline yap
- Amacı olmayan re-export'lar — yönlendirmeyi kaldır

## Adım 6: Özet

Sonuçları raporla:

```
Ölü Kod Temizliği
──────────────────────────────
Silindi:   12 kullanılmayan fonksiyon
           3 kullanılmayan dosya
           5 kullanılmayan bağımlılık
Atlandı:   2 öğe (testler başarısız)
Kazanç:    ~450 satır kaldırıldı
──────────────────────────────
Tüm testler geçiyor PASS:
```

## Kurallar

- **Önce testleri çalıştırmadan asla silmeyin**
- **Bir seferde bir silme** — Atomik değişiklikler geri almayı kolaylaştırır
- **Emin değilseniz atlayın** — Üretimi bozmaktansa ölü kodu tutmak daha iyidir
- **Temizlerken refactor etmeyin** — Endişeleri ayırın (önce temizle, sonra refactor et)
