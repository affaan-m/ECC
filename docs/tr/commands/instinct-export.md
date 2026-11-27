---
name: instinct-export
description: İçgüdüleri proje/global kapsamdan bir dosyaya aktar
command: /instinct-export
---

# Instinct Export Komutu

İçgüdüleri paylaşılabilir bir formata aktarır. Şunlar için mükemmel:
- Takım arkadaşlarıyla paylaşmak
- Yeni bir makineye aktarmak
- Proje konvansiyonlarına katkıda bulunmak

## Kullanım

```
/instinct-export                           # Tüm kişisel içgüdüleri dışa aktar
/instinct-export --domain testing          # Sadece testing içgüdülerini dışa aktar
/instinct-export --min-confidence 0.7      # Sadece yüksek güvenli içgüdüleri dışa aktar
/instinct-export --output team-instincts.yaml
/instinct-export --scope project --output project-instincts.yaml
```

## Yapılacaklar

1. Mevcut proje bağlamını tespit et
2. Seçilen kapsama göre içgüdüleri yükle:
   - `project`: sadece mevcut proje
   - `global`: sadece global
   - `all`: proje + global birleştirilmiş (varsayılan)
3. Filtreleri uygula (`--domain`, `--min-confidence`)
4. YAML formatında dosyaya yaz (veya çıktı yolu verilmediyse stdout'a)

## Çıktı Formatı

Bir YAML dosyası oluşturur:

```yaml
# Instincts Export
# Generated: 2025-01-22
# Source: personal
# Count: 12 instincts

---
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.8
domain: code-style
source: session-observation
scope: project
project_id: a1b2c3d4e5f6
project_name: my-app
---

# Prefer Functional Style

## Action
Use functional patterns over classes.
```

## Bayraklar

- `--domain <name>`: Sadece belirtilen domain'i dışa aktar
- `--min-confidence <n>`: Minimum güven eşiği
- `--output <file>`: Çıktı dosya yolu (atlandığında stdout'a yazdırır)
- `--scope <project|global|all>`: Dışa aktarma kapsamı (varsayılan: `all`)
