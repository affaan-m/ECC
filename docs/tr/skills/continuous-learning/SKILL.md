---
name: continuous-learning
description: Claude Code oturumlarından yeniden kullanılabilir kalıpları otomatik olarak çıkarın ve gelecekte kullanmak üzere öğrenilmiş skill'ler olarak kaydedin.
origin: ECC
---

# Sürekli Öğrenme Skill'i

Claude Code oturumlarını sonunda otomatik olarak değerlendirir ve öğrenilmiş skill'ler olarak kaydedilebilecek yeniden kullanılabilir kalıpları çıkarır.

## Ne Zaman Aktifleştirmelisiniz

- Claude Code oturumlarından otomatik kalıp çıkarma ayarlarken
- Oturum değerlendirmesi için Stop hook'u yapılandırırken
- `~/.claude/skills/learned/` içindeki öğrenilmiş skill'leri incelerken veya düzenlerken
- Çıkarma eşiklerini veya kalıp kategorilerini ayarlarken
- v1 (bu) ile v2 (instinct tabanlı) yaklaşımlarını karşılaştırırken

## Nasıl Çalışır

Bu skill her oturumun sonunda **Stop hook** olarak çalışır:

1. **Oturum Değerlendirmesi**: Oturumun yeterli mesaja sahip olup olmadığını kontrol eder (varsayılan: 10+)
2. **Kalıp Tespiti**: Oturumdan çıkarılabilir kalıpları tanımlar
3. **Skill Çıkarma**: Yararlı kalıpları `~/.claude/skills/learned/` dizinine kaydeder

## Konfigürasyon

Özelleştirmek için `config.json` dosyasını düzenleyin:

```json
{
  "min_session_length": 10,
  "extraction_threshold": "medium",
  "auto_approve": false,
  "learned_skills_path": "~/.claude/skills/learned/",
  "patterns_to_detect": [
    "error_resolution",
    "user_corrections",
    "workarounds",
    "debugging_techniques",
    "project_specific"
  ],
  "ignore_patterns": [
    "simple_typos",
    "one_time_fixes",
    "external_api_issues"
  ]
}
```

## Kalıp Tipleri

| Kalıp | Açıklama |
|---------|-------------|
| `error_resolution` | Belirli hataların nasıl çözüldüğü |
| `user_corrections` | Kullanıcı düzeltmelerinden kalıplar |
| `workarounds` | Framework/kütüphane tuhaflıklarına çözümler |
| `debugging_techniques` | Etkili hata ayıklama yaklaşımları |
| `project_specific` | Projeye özgü kurallar |

## Hook Kurulumu

`~/.claude/settings.json` dosyanıza ekleyin:

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning/evaluate-session.sh"
      }]
    }]
  }
}
```

## Neden Stop Hook?

- **Hafif**: Oturum sonunda bir kez çalışır
- **Bloke Etmeyen**: Her mesaja gecikme eklemez
- **Tam Bağlam**: Tam oturum kaydına erişimi vardır

## İlgili

- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - Sürekli öğrenme bölümü
- `/learn` komutu - Oturum ortasında manuel kalıp çıkarma

---

## Karşılaştırma Notları (Araştırma: Ocak 2025)

### vs Homunculus

Homunculus v2 daha sofistike bir yaklaşım benimsiyor:

| Özellik | Bizim Yaklaşım | Homunculus v2 |
|---------|--------------|---------------|
| Gözlem | Stop hook (oturum sonu) | PreToolUse/PostToolUse hooks (%100 güvenilir) |
| Analiz | Ana bağlam | Arka plan agent'ı (Haiku) |
| Granülerlik | Tam skill'ler | Atomik "instinct'ler" |
| Güven | Yok | 0.3-0.9 ağırlıklı |
| Evrim | Doğrudan skill'e | Instinct'ler → kümeleme → skill/command/agent |
| Paylaşım | Yok | Instinct'leri dışa/içe aktar |

**Homunculus'tan temel içgörü:**
> "v1 gözlem için skill'lere güveniyordu. Skill'ler olasılıksaldır—zamanın ~%50-80'inde tetiklenirler. v2 gözlem için hook'ları kullanır (%100 güvenilir) ve öğrenilmiş davranışın atomik birimi olarak instinct'leri kullanır."

### Potansiyel v2 İyileştirmeleri

1. **Instinct tabanlı öğrenme** - Güven skorlaması ile daha küçük, atomik davranışlar
2. **Arka plan gözlemcisi** - Paralel analiz yapan Haiku agent'ı
3. **Güven azalması** - Çelişkiye uğrarsa instinct'ler güven kaybeder
4. **Alan etiketleme** - code-style, testing, git, debugging, vb.
5. **Evrim yolu** - İlgili instinct'leri skill/command'lara kümeleme

Bkz: Tam spec için `docs/continuous-learning-v2-spec.md`.
