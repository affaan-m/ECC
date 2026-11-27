---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Go Testing

> Bu dosya [common/testing.md](../common/testing.md) dosyasını Go'ya özgü içerikle genişletir.

## Framework

**Table-driven testler** ile standart `go test` kullan.

## Race Detection

Daima `-race` flag'i ile çalıştır:

```bash
go test -race ./...
```

## Coverage

```bash
go test -cover ./...
```

## Referans

Detaylı Go test pattern'leri ve helper'lar için skill: `golang-testing` dosyasına bakın.
