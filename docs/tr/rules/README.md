# Kurallar (Rules)

Claude Code için kodlama kuralları ve en iyi uygulamalar.

## Dizin Yapısı

### Common (Dile Bağımsız Kurallar)

Tüm programlama dillerine uygulanan temel kurallar:

- **agents.md** - Agent orkestrasyonu ve kullanımı
- **coding-style.md** - Genel kodlama stili kuralları (immutability, dosya organizasyonu, hata yönetimi)
- **development-workflow.md** - Özellik geliştirme iş akışı (araştırma, planlama, TDD, kod incelemesi)
- **git-workflow.md** - Git commit ve PR iş akışı
- **hooks.md** - Hook sistemi (PreToolUse, PostToolUse, Stop)
- **patterns.md** - Yaygın tasarım pattern'leri (Repository, API Response Format)
- **performance.md** - Performans optimizasyonu (model seçimi, context window yönetimi)
- **security.md** - Güvenlik kuralları (secret yönetimi, güvenlik kontrolleri)
- **testing.md** - Test gereksinimleri (TDD, minimum %80 coverage)

### TypeScript/JavaScript

TypeScript ve JavaScript projeleri için özel kurallar:

- **coding-style.md** - Tip sistemleri, immutability, hata yönetimi, input validasyonu
- **hooks.md** - Prettier, TypeScript check, console.log uyarıları
- **patterns.md** - API response format, custom hooks, repository pattern
- **security.md** - Secret yönetimi, environment variable'lar
- **testing.md** - Playwright E2E testing

### Python

Python projeleri için özel kurallar:

- **coding-style.md** - PEP 8, type annotation'lar, immutability, formatlama araçları
- **hooks.md** - black/ruff formatlama, mypy/pyright tip kontrolü
- **patterns.md** - Protocol (duck typing), dataclass'lar, context manager'lar
- **security.md** - Secret yönetimi, bandit güvenlik taraması
- **testing.md** - pytest framework, coverage, test organizasyonu

### Golang

Go projeleri için özel kurallar:

- **coding-style.md** - gofmt/goimports, tasarım ilkeleri, hata yönetimi
- **hooks.md** - gofmt/goimports formatlama, go vet, staticcheck
- **patterns.md** - Functional options, küçük interface'ler, dependency injection
- **security.md** - Secret yönetimi, gosec güvenlik taraması, context & timeout'lar
- **testing.md** - Table-driven testler, race detection, coverage

## Kullanım

Bu kurallar Claude Code tarafından otomatik olarak yüklenir ve uygulanır. Kurallar:

1. **Dile bağımsız** - `common/` dizinindeki kurallar tüm projeler için geçerlidir
2. **Dile özgü** - İlgili dil dizinindeki kurallar (typescript/, python/, golang/) common kuralları genişletir
3. **Path tabanlı** - Kurallar YAML frontmatter'daki path pattern'leri ile eşleşen dosyalara uygulanır

## Orijinal Dokümantasyon

Bu dokümantasyonun İngilizce orijinali `rules/` dizininde bulunmaktadır.
