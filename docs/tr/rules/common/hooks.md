# Hooks Sistemi

## Hook Tipleri

- **PreToolUse**: Tool yürütmeden önce (validasyon, parametre değişikliği)
- **PostToolUse**: Tool yürütmeden sonra (auto-format, kontroller)
- **Stop**: Session bittiğinde (final doğrulama)

## Auto-Accept İzinleri

Dikkatli kullan:
- Güvenilir, iyi tanımlanmış planlar için etkinleştir
- Keşifsel çalışmalar için devre dışı bırak
- Asla dangerously-skip-permissions flag'i kullanma
- Bunun yerine `~/.claude/settings.json` (veya projenin `.claude/settings.json` dosyası) içinde `permissions.allow` kurallarını yapılandır

## TodoWrite En İyi Uygulamalar

TodoWrite tool'unu şunlar için kullan:
- Çok adımlı görevlerdeki ilerlemeyi takip et
- Talimatların anlaşıldığını doğrula
- Gerçek zamanlı yönlendirmeyi etkinleştir
- Detaylı implementasyon adımlarını göster

Todo listesi şunları ortaya çıkarır:
- Sıra dışı adımlar
- Eksik öğeler
- Fazladan gereksiz öğeler
- Yanlış detay düzeyi
- Yanlış yorumlanmış gereksinimler
