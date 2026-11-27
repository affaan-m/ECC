---
description: Go build hatalarını, go vet uyarılarını ve linter sorunlarını aşamalı olarak düzelt. Minimal, cerrahi düzeltmeler için go-build-resolver agent'ını çağırır.
---

# Go Build and Fix

Bu komut, minimal değişikliklerle Go build hatalarını aşamalı olarak düzeltmek için **go-build-resolver** agent'ını çağırır.

## Bu Komut Ne Yapar

1. **Diagnostics Çalıştır**: `go build`, `go vet`, `staticcheck` yürüt
2. **Hataları Parse Et**: Dosyaya göre grupla ve önem derecesine göre sırala
3. **Aşamalı Düzelt**: Bir seferde bir hata
4. **Her Düzeltmeyi Doğrula**: Her değişiklikten sonra build'i yeniden çalıştır
5. **Özet Raporla**: Neyin düzeltildiğini ve neyin kaldığını göster

## Ne Zaman Kullanılır

`/go-build` komutunu şu durumlarda kullanın:
- `go build ./...` hatalarla başarısız olduğunda
- `go vet ./...` sorunlar raporladığında
- `golangci-lint run` uyarılar gösterdiğinde
- Modül bağımlılıkları bozulduğunda
- Build'i bozan değişiklikleri pull ettikten sonra

## Çalıştırılan Diagnostic Komutları

```bash
# Birincil build kontrolü
go build ./...

# Static analiz
go vet ./...

# Genişletilmiş linting (mevcutsa)
staticcheck ./...
golangci-lint run

# Modül sorunları
go mod verify
go mod tidy -v
```

## Örnek Oturum

```text
Kullanıcı: /go-build

Agent:
# Go Build Çözümü

## İlk Diagnostics

```bash
$ go build ./...
internal/service/user.go:25:15: undefined: UserRepository
internal/handler/api.go:42:9: cannot use x (type string) as type int
internal/handler/api.go:58:2: missing return at end of function
```

Bulunan hatalar: 3

## Düzeltme 1: Tanımsız Tanımlayıcı

Dosya: internal/service/user.go:25
Hata: undefined: UserRepository
Neden: Eksik import

```go
// Import eklendi
import "project/internal/repository"

// Değiştirildi
var repo UserRepository
// Şuna
var repo repository.UserRepository
```

```bash
$ go build ./...
# 2 hata kaldı
```

## Düzeltme 2: Tip Uyuşmazlığı

Dosya: internal/handler/api.go:42
Hata: cannot use x (type string) as type int

```go
// Değiştirildi
count := params.Get("count")
// Şuna
countStr := params.Get("count")
count, _ := strconv.Atoi(countStr)
```

```bash
$ go build ./...
# 1 hata kaldı
```

## Düzeltme 3: Eksik Return

Dosya: internal/handler/api.go:58
Hata: missing return at end of function

```go
func GetUser(id string) (*User, error) {
    if id == "" {
        return nil, ErrInvalidID
    }
    user := findUser(id)
    // Eksik return eklendi
    return user, nil
}
```

```bash
$ go build ./...
# Build başarılı!
```

## Son Doğrulama

```bash
$ go vet ./...
# Sorun yok

$ go test ./...
ok      project/internal/service   0.015s
ok      project/internal/handler   0.023s
```

## Özet

| Metrik | Sayı |
|--------|-------|
| Düzeltilen build hataları | 3 |
| Düzeltilen vet uyarıları | 0 |
| Değiştirilen dosyalar | 2 |
| Kalan sorunlar | 0 |

Build Durumu: PASS: BAŞARILI
```

## Düzeltilen Yaygın Hatalar

| Hata | Tipik Düzeltme |
|-------|-------------|
| `undefined: X` | Import ekle veya yazım hatasını düzelt |
| `cannot use X as Y` | Tip dönüşümü veya atamayı düzelt |
| `missing return` | Return ifadesi ekle |
| `X does not implement Y` | Eksik metod ekle |
| `import cycle` | Paketleri yeniden yapılandır |
| `declared but not used` | Değişkeni kaldır veya kullan |
| `cannot find package` | `go get` veya `go mod tidy` |

## Düzeltme Stratejisi

1. **Önce build hataları** - Kodun compile edilmesi gerekli
2. **İkinci olarak vet uyarıları** - Şüpheli yapıları düzelt
3. **Üçüncü olarak lint uyarıları** - Stil ve en iyi uygulamalar
4. **Bir seferde bir düzeltme** - Her değişikliği doğrula
5. **Minimal değişiklikler** - Refactor etme, sadece düzelt

## Durdurma Koşulları

Agent şu durumlarda durur ve raporlar:
- Aynı hata 3 denemeden sonra devam ederse
- Düzeltme daha fazla hata oluşturursa
- Mimari değişiklikler gerektirirse
- Harici bağımlılıklar eksikse

## İlgili Komutlar

- `/go-test` - Build başarılı olduktan sonra testleri çalıştır
- `/go-review` - Kod kalitesini incele
- `/verify` - Tam doğrulama döngüsü

## İlgili

- Agent: `agents/go-build-resolver.md`
- Skill: `skills/golang-patterns/`
