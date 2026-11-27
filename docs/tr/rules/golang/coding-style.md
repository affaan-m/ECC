---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Go Kodlama Stili

> Bu dosya [common/coding-style.md](../common/coding-style.md) dosyasını Go'ya özgü içerikle genişletir.

## Formatlama

- **gofmt** ve **goimports** zorunludur — stil tartışması yok

## Tasarım İlkeleri

- Interface'leri kabul et, struct'ları döndür
- Interface'leri küçük tut (1-3 metot)

## Hata Yönetimi

Hataları daima context ile sarmalayın:

```go
if err != nil {
    return fmt.Errorf("failed to create user: %w", err)
}
```

## Referans

Kapsamlı Go idiom'ları ve pattern'leri için skill: `golang-patterns` dosyasına bakın.
