---
description: Go için TDD iş akışını zorlar. Önce table-driven testler yaz, sonra uygula. go test -cover ile %80+ kapsama doğrula.
---

# Go TDD Komutu

Bu komut, idiomatic Go test desenlerini kullanarak Go kodu için test odaklı geliştirme metodolojisini zorlar.

## Bu Komut Ne Yapar

1. **Tipleri/Interface'leri Tanımla**: Önce fonksiyon imzalarını tasarla
2. **Table-Driven Testler Yaz**: Kapsamlı test senaryoları oluştur (RED)
3. **Testleri Çalıştır**: Testlerin doğru sebepten başarısız olduğunu doğrula
4. **Kodu Uygula**: Geçmek için minimal kod yaz (GREEN)
5. **Refactor Et**: Testleri yeşil tutarken iyileştir
6. **Kapsama Kontrol Et**: %80+ kapsama sağla

## Ne Zaman Kullanılır

`/go-test` komutunu şu durumlarda kullanın:
- Yeni Go fonksiyonları uygularken
- Mevcut koda test kapsama eklerken
- Hataları düzeltirken (önce başarısız test yaz)
- Kritik iş mantığı oluştururken
- Go'da TDD iş akışını öğrenirken

## TDD Döngüsü

```
RED     → Başarısız table-driven test yaz
GREEN   → Geçmek için minimal kod uygula
REFACTOR → Kodu iyileştir, testler yeşil kalsın
TEKRARLA → Sonraki test senaryosu
```

## Örnek Oturum

````
Kullanıcı: /go-test E-posta adreslerini doğrulamak için bir fonksiyona ihtiyacım var

Agent:
# TDD Oturumu: E-posta Doğrulayıcı

## Adım 1: Interface Tanımla

```go
// validator/email.go
package validator

// ValidateEmail verilen string'in geçerli bir e-posta adresi olup olmadığını kontrol eder.
// Geçerliyse nil, aksi takdirde sorunu açıklayan hata döndürür.
func ValidateEmail(email string) error {
    panic("not implemented")
}
```

## Adım 2: Table-Driven Testler Yaz (RED)

```go
// validator/email_test.go
package validator

import (
    "testing"
)

func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        wantErr bool
    }{
        // Geçerli e-postalar
        {"basit e-posta", "user@example.com", false},
        {"subdomain ile", "user@mail.example.com", false},
        {"artı ile", "user+tag@example.com", false},
        {"noktalar ile", "first.last@example.com", false},

        // Geçersiz e-postalar
        {"boş string", "", true},
        {"at işareti yok", "userexample.com", true},
        {"domain yok", "user@", true},
        {"local kısım yok", "@example.com", true},
        {"çift at", "user@@example.com", true},
        {"boşluklar", "user @example.com", true},
        {"tld yok", "user@example", true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidateEmail(tt.email)
            if tt.wantErr && err == nil {
                t.Errorf("ValidateEmail(%q) = nil; hata bekleniyor", tt.email)
            }
            if !tt.wantErr && err != nil {
                t.Errorf("ValidateEmail(%q) = %v; nil bekleniyor", tt.email, err)
            }
        })
    }
}
```

## Adım 3: Testleri Çalıştır - Başarısızlığı Doğrula

```bash
$ go test ./validator/...

--- FAIL: TestValidateEmail (0.00s)
    --- FAIL: TestValidateEmail/basit_e-posta (0.00s)
        panic: not implemented

FAIL
```

✓ Testler beklendiği gibi başarısız (panic).

## Adım 4: Minimal Kod Uygula (GREEN)

```go
// validator/email.go
package validator

import (
    "errors"
    "regexp"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

var (
    ErrEmailEmpty   = errors.New("e-posta boş olamaz")
    ErrEmailInvalid = errors.New("e-posta formatı geçersiz")
)

func ValidateEmail(email string) error {
    if email == "" {
        return ErrEmailEmpty
    }
    if !emailRegex.MatchString(email) {
        return ErrEmailInvalid
    }
    return nil
}
```

## Adım 5: Testleri Çalıştır - Başarıyı Doğrula

```bash
$ go test ./validator/...

PASS
ok      project/validator    0.003s
```

✓ Tüm testler geçiyor!

## Adım 6: Kapsama Kontrol Et

```bash
$ go test -cover ./validator/...

PASS
coverage: 100.0% of statements
ok      project/validator    0.003s
```

✓ Kapsama: 100%

## TDD Tamamlandı!
````

## Test Desenleri

### Table-Driven Testler
```go
tests := []struct {
    name     string
    input    InputType
    want     OutputType
    wantErr  bool
}{
    {"senaryo 1", input1, want1, false},
    {"senaryo 2", input2, want2, true},
}

for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        got, err := Function(tt.input)
        // assertion'lar
    })
}
```

### Paralel Testler
```go
for _, tt := range tests {
    tt := tt // Yakala
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        // test gövdesi
    })
}
```

### Test Yardımcıları
```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db := createDB()
    t.Cleanup(func() { db.Close() })
    return db
}
```

## Kapsama Komutları

```bash
# Basit kapsama
go test -cover ./...

# Kapsama profili
go test -coverprofile=coverage.out ./...

# Tarayıcıda görüntüle
go tool cover -html=coverage.out

# Fonksiyona göre kapsama
go tool cover -func=coverage.out

# Race tespiti ile
go test -race -cover ./...
```

## Kapsama Hedefleri

| Kod Türü | Hedef |
|-----------|--------|
| Kritik iş mantığı | 100% |
| Public API'ler | 90%+ |
| Genel kod | 80%+ |
| Oluşturulan kod | Hariç tut |

## TDD En İyi Uygulamaları

**YAPIN:**
- Herhangi bir uygulamadan ÖNCE test yaz
- Her değişiklikten sonra testleri çalıştır
- Kapsamlı kapsama için table-driven testler kullan
- Uygulama detaylarını değil, davranışı test et
- Edge case'leri dahil et (boş, nil, maksimum değerler)

**YAPMAYIN:**
- Testlerden önce uygulama yazma
- RED aşamasını atlama
- Private fonksiyonları doğrudan test etme
- Testlerde `time.Sleep` kullanma
- Dengesiz testleri görmezden gelme

## İlgili Komutlar

- `/go-build` - Build hatalarını düzelt
- `/go-review` - Uygulamadan sonra kodu incele
- `/verify` - Tam doğrulama döngüsünü çalıştır

## İlgili

- Skill: `skills/golang-testing/`
- Skill: `skills/tdd-workflow/`
