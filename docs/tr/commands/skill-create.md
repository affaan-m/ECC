---
name: skill-create
description: Kodlama desenlerini çıkarmak ve SKILL.md dosyaları oluşturmak için yerel git geçmişini analiz et. Skill Creator GitHub App'ın yerel versiyonu.
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /skill-create - Yerel Skill Oluşturma

Repository'nizin git geçmişini analiz ederek kodlama desenlerini çıkarın ve Claude'a ekibinizin uygulamalarını öğreten SKILL.md dosyaları oluşturun.

## Kullanım

```bash
/skill-create                    # Mevcut repo'yu analiz et
/skill-create --commits 100      # Son 100 commit'i analiz et
/skill-create --output ./skills  # Özel çıktı dizini
/skill-create --instincts        # continuous-learning-v2 için instinct'ler de oluştur
```

## Ne Yapar

1. **Git Geçmişini Parse Eder** - Commit'leri, dosya değişikliklerini ve desenleri analiz eder
2. **Desenleri Tespit Eder** - Tekrarlayan iş akışlarını ve kuralları tanımlar
3. **SKILL.md Oluşturur** - Geçerli Claude Code skill dosyaları oluşturur
4. **İsteğe Bağlı Instinct'ler Oluşturur** - continuous-learning-v2 sistemi için

## Analiz Adımları

### Adım 1: Git Verilerini Topla

```bash
# Dosya değişiklikleriyle son commit'leri al
git log --oneline -n ${COMMITS:-200} --name-only --pretty=format:"%H|%s|%ad" --date=short

# Dosyaya göre commit sıklığını al
git log --oneline -n 200 --name-only | grep -v "^$" | grep -v "^[a-f0-9]" | sort | uniq -c | sort -rn | head -20

# Commit mesaj desenlerini al
git log --oneline -n 200 | cut -d' ' -f2- | head -50
```

### Adım 2: Desenleri Tespit Et

Bu desen türlerini ara:

| Desen | Tespit Yöntemi |
|---------|-----------------|
| **Commit kuralları** | Commit mesajlarında regex (feat:, fix:, chore:) |
| **Dosya birlikte değişimleri** | Her zaman birlikte değişen dosyalar |
| **İş akışı dizileri** | Tekrarlanan dosya değişim desenleri |
| **Mimari** | Klasör yapısı ve isimlendirme kuralları |
| **Test desenleri** | Test dosya konumları, isimlendirme, kapsama |

### Adım 3: SKILL.md Oluştur

Çıktı formatı:

```markdown
---
name: {repo-name}-patterns
description: {repo-name}'den çıkarılan kodlama desenleri
version: 1.0.0
source: local-git-analysis
analyzed_commits: {count}
---

# {Repo Name} Desenleri

## Commit Kuralları
{tespit edilen commit mesaj desenleri}

## Kod Mimarisi
{tespit edilen klasör yapısı ve organizasyon}

## İş Akışları
{tespit edilen tekrarlayan dosya değişim desenleri}

## Test Desenleri
{tespit edilen test kuralları}
```

### Adım 4: Instinct'ler Oluştur (--instincts varsa)

continuous-learning-v2 entegrasyonu için:

```yaml
---
id: {repo}-commit-convention
trigger: "bir commit mesajı yazarken"
confidence: 0.8
domain: git
source: local-repo-analysis
---

# Conventional Commits Kullan

## Aksiyon
Commit'leri şu öneklerle başlat: feat:, fix:, chore:, docs:, test:, refactor:

## Kanıt
- {n} commit analiz edildi
- {percentage}% conventional commit formatını takip ediyor
```

## Örnek Çıktı

Bir TypeScript projesinde `/skill-create` çalıştırmak şunları üretebilir:

```markdown
---
name: my-app-patterns
description: my-app repository'sinden kodlama desenleri
version: 1.0.0
source: local-git-analysis
analyzed_commits: 150
---

# My App Desenleri

## Commit Kuralları

Bu proje **conventional commits** kullanıyor:
- `feat:` - Yeni özellikler
- `fix:` - Hata düzeltmeleri
- `chore:` - Bakım görevleri
- `docs:` - Dokümantasyon güncellemeleri

## Kod Mimarisi

```
src/
├── components/     # React componentleri (PascalCase.tsx)
├── hooks/          # Özel hook'lar (use*.ts)
├── utils/          # Yardımcı fonksiyonlar
├── types/          # TypeScript tip tanımları
└── services/       # API ve harici servisler
```

## İş Akışları

### Yeni Bir Component Ekleme
1. `src/components/ComponentName.tsx` oluştur
2. `src/components/__tests__/ComponentName.test.tsx`'de testler ekle
3. `src/components/index.ts`'den export et

### Database Migration
1. `src/db/schema.ts`'yi değiştir
2. `pnpm db:generate` çalıştır
3. `pnpm db:migrate` çalıştır

## Test Desenleri

- Test dosyaları: `__tests__/` dizinleri veya `.test.ts` eki
- Kapsama hedefi: 80%+
- Framework: Vitest
```

## GitHub App Entegrasyonu

Gelişmiş özellikler için (10k+ commit, ekip paylaşımı, otomatik PR'lar), [Skill Creator GitHub App](https://github.com/apps/skill-creator) kullanın:

- Yükle: [github.com/apps/skill-creator](https://github.com/apps/skill-creator)
- Herhangi bir issue'da `/skill-creator analyze` yorumu yap
- Oluşturulan skill'lerle PR alın

## İlgili Komutlar

- `/instinct-import` - Oluşturulan instinct'leri import et
- `/instinct-status` - Öğrenilen instinct'leri görüntüle
- `/evolve` - Instinct'leri skill'ler/agent'lara kümelendir

---

*[Everything Claude Code](https://github.com/affaan-m/everything-claude-code)'un bir parçası*
