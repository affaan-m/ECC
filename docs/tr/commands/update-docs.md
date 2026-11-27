# Update Documentation

Dokümanları codebase ile senkronize et, truth-of-source dosyalarından oluştur.

## Adım 1: Truth Kaynaklarını Tanımla

| Kaynak | Oluşturur |
|--------|-----------|
| `package.json` scripts | Mevcut komutlar referansı |
| `.env.example` | Environment variable dokümanı |
| `openapi.yaml` / route dosyaları | API endpoint referansı |
| Kaynak kod export'ları | Public API dokümanı |
| `Dockerfile` / `docker-compose.yml` | Altyapı kurulum dokümanları |

## Adım 2: Script Referansı Oluştur

1. `package.json`'ı oku (veya `Makefile`, `Cargo.toml`, `pyproject.toml`)
2. Tüm script'leri/komutları açıklamalarıyla birlikte çıkar
3. Bir referans tablosu oluştur:

```markdown
| Command | Description |
|---------|-------------|
| `npm run dev` | Hot reload ile development server'ı başlat |
| `npm run build` | Type checking ile production build |
| `npm test` | Coverage ile test suite'ini çalıştır |
```

## Adım 3: Environment Dokümanı Oluştur

1. `.env.example`'ı oku (veya `.env.template`, `.env.sample`)
2. Tüm değişkenleri amaçlarıyla birlikte çıkar
3. Zorunlu vs isteğe bağlı olarak kategorize et
4. Beklenen format ve geçerli değerleri dokümante et

```markdown
| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | PostgreSQL bağlantı string'i | `postgres://user:pass@host:5432/db` |
| `LOG_LEVEL` | No | Log detay seviyesi (varsayılan: info) | `debug`, `info`, `warn`, `error` |
```

## Adım 4: Contributing Guide'ı Güncelle

`docs/CONTRIBUTING.md`'yi şunlarla oluştur veya güncelle:
- Development environment kurulumu (ön koşullar, kurulum adımları)
- Mevcut script'ler ve amaçları
- Test prosedürleri (nasıl çalıştırılır, nasıl yeni test yazılır)
- Kod stili zorlama (linter, formatter, pre-commit hook'ları)
- PR gönderim kontrol listesi

## Adım 5: Runbook'u Güncelle

`docs/RUNBOOK.md`'yi şunlarla oluştur veya güncelle:
- Deployment prosedürleri (adım adım)
- Health check endpoint'leri ve izleme
- Yaygın sorunlar ve düzeltmeleri
- Rollback prosedürleri
- Uyarı ve eskalasyon yolları

## Adım 6: Güncellik Kontrolü

1. 90+ gün değiştirilmemiş doküman dosyalarını bul
2. Son kaynak kod değişiklikleriyle çapraz referans yap
3. Manuel gözden geçirme için potansiyel güncel olmayan dokümanları işaretle

## Adım 7: Özeti Göster

```
Documentation Update
──────────────────────────────
Updated:  docs/CONTRIBUTING.md (scripts table)
Updated:  docs/ENV.md (3 new variables)
Flagged:  docs/DEPLOY.md (142 days stale)
Skipped:  docs/API.md (no changes detected)
──────────────────────────────
```

## Kurallar

- **Tek truth kaynağı**: Her zaman koddan oluştur, oluşturulan bölümleri asla manuel düzenleme
- **Manuel bölümleri koru**: Sadece oluşturulan bölümleri güncelle; elle yazılmış prose'u bozulmamış bırak
- **Oluşturulan içeriği işaretle**: Oluşturulan bölümlerin etrafında `<!-- AUTO-GENERATED -->` marker'ları kullan
- **İstenmeyen doküman oluşturma**: Sadece komut açıkça talep ederse yeni doküman dosyaları oluştur
