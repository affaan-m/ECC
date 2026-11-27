# Örnek Konfigürasyon Dosyaları

Bu dizin, Claude Code için örnek konfigürasyon dosyalarını içerir.

## Dosyalar

### CLAUDE.md
Proje seviyesi konfigürasyon dosyası örneği. Bu dosyayı proje kök dizininize yerleştirin.

**İçerik:**
- Proje genel bakış
- Kritik kurallar (kod organizasyonu, stil, test, güvenlik)
- Dosya yapısı
- Temel desenler
- Environment variable'lar
- Kullanılabilir komutlar
- Git iş akışı

**Konum:** `<proje-kök>/CLAUDE.md`

### user-CLAUDE.md
Kullanıcı seviyesi konfigürasyon dosyası örneği. Bu, tüm projelerinizde geçerli olan global ayarlarınızdır.

**İçerik:**
- Temel felsefe ve prensipler
- Modüler kurallar
- Kullanılabilir agent'lar
- Kişisel tercihler (gizlilik, kod stili, git, test)
- Bilgi yakalama stratejisi
- Editor entegrasyonu
- Başarı metrikleri

**Konum:** `~/.claude/CLAUDE.md`

### statusline.json
Özel durum satırı konfigürasyonu. Claude Code'un terminal arayüzünde gösterilen durum satırını özelleştirir.

**Özellikler:**
- Kullanıcı adı ve çalışma dizini
- Git branch ve dirty status
- Kalan context yüzdesi
- Model adı
- Saat
- Todo sayısı

**Konum:** `~/.claude/settings.json` içine ekleyin

## Kullanım

### Proje Seviyesi Konfigürasyon
```bash
# Proje kök dizininize kopyalayın
cp docs/tr/examples/CLAUDE.md ./CLAUDE.md
# İçeriği projenize göre düzenleyin
```

### Kullanıcı Seviyesi Konfigürasyon
```bash
# Ana dizininize kopyalayın
mkdir -p ~/.claude
cp docs/tr/examples/user-CLAUDE.md ~/.claude/CLAUDE.md
# Kişisel tercihlerinize göre düzenleyin
```

### Status Line Konfigürasyonu
```bash
# settings.json dosyanıza ekleyin
cat docs/tr/examples/statusline.json >> ~/.claude/settings.json
```

## Notlar

- Konfigürasyon dosyaları Markdown formatındadır
- Teknik terimler İngilizce bırakılmıştır
- Konfigürasyon syntax'ı değişmemiştir
- Sadece açıklamalar ve yorumlar Türkçe'ye çevrilmiştir

## İlgili Kaynaklar

- [Ana Dokümantasyon](../README.md)
