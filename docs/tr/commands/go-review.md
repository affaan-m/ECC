---
description: İdiomatic desenler, eşzamanlılık güvenliği, hata yönetimi ve güvenlik için kapsamlı Go kod incelemesi. go-reviewer agent'ını çağırır.
---

# Go Code Review

Bu komut, Go'ya özel kapsamlı kod incelemesi için **go-reviewer** agent'ını çağırır.

## Bu Komut Ne Yapar

1. **Go Değişikliklerini Tanımla**: `git diff` ile değiştirilmiş `.go` dosyalarını bul
2. **Static Analiz Çalıştır**: `go vet`, `staticcheck` ve `golangci-lint` yürüt
3. **Güvenlik Taraması**: SQL injection, command injection, race condition'ları kontrol et
4. **Eşzamanlılık İncelemesi**: Goroutine güvenliğini, channel kullanımını, mutex desenlerini analiz et
5. **İdiomatic Go Kontrolü**: Kodun Go kurallarına ve en iyi uygulamalara uyduğunu doğrula
6. **Rapor Oluştur**: Sorunları önem derecesine göre kategorize et

## Ne Zaman Kullanılır

`/go-review` komutunu şu durumlarda kullanın:
- Go kodu yazdıktan veya değiştirdikten sonra
- Go değişikliklerini commit etmeden önce
- Go kodu içeren pull request'leri incelerken
- Yeni bir Go kod tabanına adapte olurken
- İdiomatic Go desenlerini öğrenirken

## İnceleme Kategorileri

### KRİTİK (Düzeltilmeli)
- SQL/Command injection açıklıkları
- Senkronizasyon olmadan race condition'lar
- Goroutine sızıntıları
- Hardcode edilmiş kimlik bilgileri
- Güvenli olmayan pointer kullanımı
- Kritik yollarda göz ardı edilen hatalar

### YÜKSEK (Düzeltilmeli)
- Bağlamlı hata sarmalama eksikliği
- Hata dönüşleri yerine panic
- Context yayılmıyor
- Deadlock'a neden olan buffersız channel'lar
- Interface yerine getirilmeme hataları
- Eksik mutex koruması

### ORTA (Düşünün)
- İdiomatic olmayan kod desenleri
- Export edilen elementlerde eksik godoc yorumları
- Verimsiz string birleştirme
- Preallocate edilmemiş slice
- Table-driven testler kullanılmamış

## Çalıştırılan Otomatik Kontroller

```bash
# Static analiz
go vet ./...

# Gelişmiş kontroller (kuruluysa)
staticcheck ./...
golangci-lint run

# Race tespiti
go build -race ./...

# Güvenlik açıklıkları
govulncheck ./...
```

## Örnek Kullanım

```text
Kullanıcı: /go-review

Agent:
# Go Kod İnceleme Raporu

## İncelenen Dosyalar
- internal/handler/user.go (değiştirildi)
- internal/service/auth.go (değiştirildi)

## Static Analiz Sonuçları
✓ go vet: Sorun yok
✓ staticcheck: Sorun yok

## Bulunan Sorunlar

[KRİTİK] Race Condition
Dosya: internal/service/auth.go:45
Sorun: Paylaşılan map senkronizasyon olmadan erişiliyor
```go
var cache = map[string]*Session{}  // Eşzamanlı erişim!

func GetSession(id string) *Session {
    return cache[id]  // Race condition
}
```
Düzeltme: sync.RWMutex veya sync.Map kullan
```go
var (
    cache   = map[string]*Session{}
    cacheMu sync.RWMutex
)

func GetSession(id string) *Session {
    cacheMu.RLock()
    defer cacheMu.RUnlock()
    return cache[id]
}
```

[YÜKSEK] Eksik Hata Bağlamı
Dosya: internal/handler/user.go:28
Sorun: Hata bağlam olmadan döndürülüyor
```go
return err  // Bağlam yok
```
Düzeltme: Bağlamla sarmala
```go
return fmt.Errorf("get user %s: %w", userID, err)
```

## Özet
- KRİTİK: 1
- YÜKSEK: 1
- ORTA: 0

Öneri: FAIL: KRİTİK sorun düzeltilene kadar merge'i engelle
```

## Onay Kriterleri

| Durum | Koşul |
|--------|-----------|
| PASS: Onayla | KRİTİK veya YÜKSEK sorun yok |
| WARNING: Uyarı | Sadece ORTA sorunlar (dikkatle merge et) |
| FAIL: Engelle | KRİTİK veya YÜKSEK sorun bulundu |

## Diğer Komutlarla Entegrasyon

- Testlerin geçtiğinden emin olmak için önce `/go-test` kullanın
- Build hataları oluşursa `/go-build` kullanın
- Commit etmeden önce `/go-review` kullanın
- Go'ya özel olmayan endişeler için `/code-review` kullanın

## İlgili

- Agent: `agents/go-reviewer.md`
- Skills: `skills/golang-patterns/`, `skills/golang-testing/`
