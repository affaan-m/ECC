# Build and Fix

Build ve tip hatalarını minimal, güvenli değişikliklerle aşamalı olarak düzelt.

## Adım 1: Build Sistemini Tespit Et

Projenin build aracını tanımla ve build'i çalıştır:

| İndikatör | Build Komutu |
|-----------|---------------|
| `build` script'i olan `package.json` | `npm run build` veya `pnpm build` |
| `tsconfig.json` (sadece TypeScript) | `npx tsc --noEmit` |
| `Cargo.toml` | `cargo build 2>&1` |
| `pom.xml` | `mvn compile` |
| `build.gradle` | `./gradlew compileJava` |
| `go.mod` | `go build ./...` |
| `pyproject.toml` | `python -m py_compile` veya `mypy .` |

## Adım 2: Hataları Parse Et ve Grupla

1. Build komutunu çalıştır ve stderr'i yakala
2. Hataları dosya yoluna göre grupla
3. Bağımlılık sırasına göre sırala (mantık hatalarından önce import/tipleri düzelt)
4. İlerleme takibi için toplam hataları say

## Adım 3: Düzeltme Döngüsü (Tek Seferde Bir Hata)

Her hata için:

1. **Dosyayı oku** — Hata bağlamını görmek için Read aracını kullan (hatanın etrafında 10 satır)
2. **Teşhis et** — Kök nedeni tanımla (eksik import, yanlış tip, sözdizimi hatası)
3. **Minimal düzelt** — Hatayı çözen en küçük değişiklik için Edit aracını kullan
4. **Build'i yeniden çalıştır** — Hatanın gittiğini ve yeni hata oluşmadığını doğrula
5. **Sonrakine geç** — Kalan hatalarla devam et

## Adım 4: Koruma Önlemleri

Şu durumlarda dur ve kullanıcıya sor:
- Bir düzeltme **çözdüğünden daha fazla hata oluşturuyorsa**
- **Aynı hata 3 denemeden sonra devam ediyorsa** (muhtemelen daha derin bir sorun)
- Düzeltme **mimari değişiklikler gerektiriyorsa** (sadece build düzeltmesi değil)
- Build hataları **eksik bağımlılıklardan** kaynaklanıyorsa (`npm install`, `cargo add`, vb. gerekli)

## Adım 5: Özet

Sonuçları göster:
- Düzeltilen hatalar (dosya yollarıyla)
- Kalan hatalar (varsa)
- Oluşturulan yeni hatalar (sıfır olmalı)
- Çözülmemiş sorunlar için önerilen sonraki adımlar

## Kurtarma Stratejileri

| Durum | Aksiyon |
|-----------|--------|
| Eksik modül/import | Paketin yüklü olup olmadığını kontrol et; install komutu öner |
| Tip uyuşmazlığı | Her iki tip tanımını oku; daha dar olanı düzelt |
| Döngüsel bağımlılık | Import grafiği ile döngüyü tanımla; extraction öner |
| Versiyon çakışması | Versiyon kısıtlamaları için `package.json` / `Cargo.toml` kontrol et |
| Build aracı yanlış yapılandırması | Config dosyasını oku; çalışan varsayılanlarla karşılaştır |

Güvenlik için bir seferde bir hatayı düzelt. Refactoring yerine minimal diff'leri tercih et.
