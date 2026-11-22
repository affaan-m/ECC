# Performans Optimizasyonu

## Model Seçim Stratejisi

**Haiku 4.5** (Sonnet kapasitesinin %90'ı, 3x maliyet tasarrufu):
- Sık çağrılan hafif agent'lar
- Pair programming ve kod üretimi
- Multi-agent sistemlerinde worker agent'lar

**Sonnet 5** (En iyi kodlama modeli):
- Ana geliştirme çalışması
- Multi-agent iş akışlarını orkestrasyon
- Karmaşık kodlama görevleri

**Opus 5** (En derin akıl yürütme):
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

Claude Code'da uyarlanabilir akıl yürütme, modelin her görev için ne kadar düşüneceğine kendisinin karar vermesini sağlar. Fable modelleri, Sonnet 5 ve sonrası ile Opus 4.7 ve sonrası için sabit bir token bütçesi yerine akıl yürütmeyi effort ile kontrol et. Kullanılabilir seviyeler modele göre değişir.

Extended thinking kontrolü:
- **Effort**: Oturum içinde `/effort`, başlatırken `--effort <level>` veya `CLAUDE_CODE_EFFORT_LEVEL` kullan; ortam değişkeni ikisinden de önce gelir, bu yüzden başka bir kontrol kullanmadan önce onu tanımlı olduğu yerden kaldır ve Claude Code'u yeniden başlat. `~/.claude/settings.json` içindeki `modelSettings` altında model başına seviye kaydet; eski kullanıcı düzeyi `effortLevel` anahtarı Opus 5.5 veya daha yeni modellerde geçerli değildir.
- **Toggle**: Option+T (macOS) / Alt+T (Windows/Linux) veya ayarlarda `alwaysThinkingEnabled`. Bunlar Opus 5.5, Sonnet 5.5 veya Fable modellerinde düşünmeyi devre dışı bırakamaz.
- **Sabit bütçe**: Claude Code, uyarlanabilir akıl yürütme modellerinde pozitif `MAX_THINKING_TOKENS` değerlerini yok sayar. Opus 4.6 veya Sonnet 4.6 üzerinde, `MAX_THINKING_TOKENS` ile sabit bütçe kullanmak için `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` ayarla.
- **Verbose mode**: Thinking çıktısını görmek için Ctrl+O

Desteklenen kontroller için [Claude Code model yapılandırması](https://code.claude.com/docs/en/model-config#adjust-effort-level) ve [ortam değişkenleri](https://code.claude.com/docs/en/env-vars) bölümlerine bak.

Derin akıl yürütme gerektiren karmaşık görevler için:
1. Mevcut seviyeyi kontrol et ve `/effort` ile desteklenen daha yüksek bir seviye seç; Opus 4.7 zaten `xhigh` ile başlar, bu yüzden `high` seviyeyi düşürür
2. Yapılandırılmış yaklaşım için **Plan Mode**'u etkinleştir
3. Kapsamlı analiz için birden fazla kritik tur kullan
4. Çeşitli perspektifler için split role sub-agent'lar kullan

## Build Sorun Giderme

Build başarısız olursa:
1. **build-error-resolver** agent kullan
2. Hata mesajlarını analiz et
3. Aşamalı olarak düzelt
4. Her düzeltmeden sonra doğrula
