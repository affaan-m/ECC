# Performans Optimizasyonu

## Model Seçim Stratejisi

**Haiku 4.5** (Sonnet kapasitesinin %90'ı, 3x maliyet tasarrufu):
- Sık çağrılan hafif agent'lar
- Pair programming ve kod üretimi
- Multi-agent sistemlerinde worker agent'lar

**Sonnet 4.6** (En iyi kodlama modeli):
- Ana geliştirme çalışması
- Multi-agent iş akışlarını orkestrasyon
- Karmaşık kodlama görevleri

**Opus 4.6** (En derin akıl yürütme):
- Karmaşık mimari kararlar
- Maksimum akıl yürütme gereksinimleri
- Araştırma ve analiz görevleri

## Context Window Yönetimi

Context window'un son %20'sinden kaçın:
- Büyük ölçekli refactoring
- Birden fazla dosyaya yayılan özellik implementasyonu
- Karmaşık etkileşimleri debug etme

Daha düşük context hassasiyeti olan görevler:
- Tek dosya düzenlemeleri
- Bağımsız utility oluşturma
- Dokümantasyon güncellemeleri
- Basit hata düzeltmeleri

## Extended Thinking + Plan Mode

Extended thinking varsayılan olarak etkindir ve dahili akıl yürütme için 31,999 token'a kadar ayırır.

Extended thinking kontrolü:
- **Toggle**: Option+T (macOS) / Alt+T (Windows/Linux)
- **Config**: `~/.claude/settings.json` içinde `alwaysThinkingEnabled` ayarla
- **Budget cap**: `export MAX_THINKING_TOKENS=10000` (bash) veya `$env:MAX_THINKING_TOKENS = "10000"` (PowerShell)
- **Verbose mode**: Thinking çıktısını görmek için Ctrl+O

Derin akıl yürütme gerektiren karmaşık görevler için:
1. Extended thinking'in etkin olduğundan emin ol (varsayılan olarak açık)
2. Yapılandırılmış yaklaşım için **Plan Mode**'u etkinleştir
3. Kapsamlı analiz için birden fazla kritik tur kullan
4. Çeşitli perspektifler için split role sub-agent'lar kullan

## Build Sorun Giderme

Build başarısız olursa:
1. **build-error-resolver** agent kullan
2. Hata mesajlarını analiz et
3. Aşamalı olarak düzelt
4. Her düzeltmeden sonra doğrula
