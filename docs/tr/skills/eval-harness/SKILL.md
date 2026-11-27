---
name: eval-harness
description: Eval-driven development (EDD) ilkelerini uygulayan Claude Code oturumları için formal değerlendirme çerçevesi
origin: ECC
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Eval Harness Skill

Claude Code oturumları için eval-driven development (EDD) ilkelerini uygulayan formal değerlendirme çerçevesi.

## Ne Zaman Aktifleştirmeli

- AI destekli iş akışları için eval-driven development (EDD) kurarken
- Claude Code görev tamamlama için geçti/kaldı kriterleri tanımlarken
- pass@k metrikleriyle agent güvenilirliğini ölçerken
- Prompt veya agent değişiklikleri için regresyon test paketleri oluştururken
- Model versiyonları arasında agent performansını benchmark ederken

## Felsefe

Eval-Driven Development, eval'ları "AI geliştirmenin birim testleri" olarak ele alır:
- İmplementasyondan ÖNCE beklenen davranışı tanımla
- Geliştirme sırasında eval'ları sürekli çalıştır
- Her değişiklikle regresyonları izle
- Güvenilirlik ölçümü için pass@k metriklerini kullan

## Eval Tipleri

### Capability Eval'ları
Claude'un daha önce yapamadığı bir şeyi yapıp yapamadığını test et:
```markdown
[CAPABILITY EVAL: feature-name]
Görev: Claude'un başarması gereken şeyin açıklaması
Başarı Kriterleri:
  - [ ] Kriter 1
  - [ ] Kriter 2
  - [ ] Kriter 3
Beklenen Çıktı: Beklenen sonucun açıklaması
```

### Regression Eval'ları
Değişikliklerin mevcut fonksiyonaliteyi bozmadığından emin ol:
```markdown
[REGRESSION EVAL: feature-name]
Baseline: SHA veya checkpoint adı
Testler:
  - existing-test-1: PASS/FAIL
  - existing-test-2: PASS/FAIL
  - existing-test-3: PASS/FAIL
Sonuç: X/Y geçti (önceden Y/Y)
```

## Grader Tipleri

### 1. Code-Based Grader
Kod kullanarak deterministik kontroller:
```bash
# Dosyanın beklenen pattern içerip içermediğini kontrol et
grep -q "export function handleAuth" src/auth.ts && echo "PASS" || echo "FAIL"

# Testlerin geçip geçmediğini kontrol et
npm test -- --testPathPattern="auth" && echo "PASS" || echo "FAIL"

# Build'in başarılı olup olmadığını kontrol et
npm run build && echo "PASS" || echo "FAIL"
```

### 2. Model-Based Grader
Açık uçlu çıktıları değerlendirmek için Claude kullan:
```markdown
[MODEL GRADER PROMPT]
Aşağıdaki kod değişikliğini değerlendir:
1. Belirtilen sorunu çözüyor mu?
2. İyi yapılandırılmış mı?
3. Edge case'ler işleniyor mu?
4. Hata işleme uygun mu?

Puan: 1-5 (1=kötü, 5=mükemmel)
Gerekçe: [açıklama]
```

### 3. Human Grader
Manuel inceleme için işaretle:
```markdown
[HUMAN REVIEW REQUIRED]
Değişiklik: Neyin değiştiğinin açıklaması
Sebep: Neden insan incelemesi gerekli
Risk Seviyesi: DÜŞÜK/ORTA/YÜKSEK
```

## Metrikler

### pass@k
"k denemede en az bir başarı"
- pass@1: İlk deneme başarı oranı
- pass@3: 3 denemede başarı
- Tipik hedef: pass@3 > %90

### pass^k
"Tüm k denemeler başarılı"
- Güvenilirlik için daha yüksek çıta
- pass^3: Ardışık 3 başarı
- Kritik yollar için kullan

## Eval İş Akışı

### 1. Tanımla (Kodlamadan Önce)
```markdown
## EVAL DEFINITION: feature-xyz

### Capability Eval'ları
1. Yeni kullanıcı hesabı oluşturabilir
2. Email formatını doğrulayabilir
3. Şifreyi güvenli şekilde hash'leyebilir

### Regression Eval'ları
1. Mevcut login hala çalışıyor
2. Oturum yönetimi değişmedi
3. Logout akışı sağlam

### Başarı Metrikleri
- capability eval'lar için pass@3 > %90
- regression eval'lar için pass^3 = %100
```

### 2. Uygula
Tanımlanan eval'ları geçmek için kod yaz.

### 3. Değerlendir
```bash
# Capability eval'ları çalıştır
[Her capability eval'ı çalıştır, PASS/FAIL kaydet]

# Regression eval'ları çalıştır
npm test -- --testPathPattern="existing"

# Rapor oluştur
```

### 4. Rapor
```markdown
EVAL REPORT: feature-xyz
========================

Capability Eval'ları:
  create-user:     PASS (pass@1)
  validate-email:  PASS (pass@2)
  hash-password:   PASS (pass@1)
  Genel:           3/3 geçti

Regression Eval'ları:
  login-flow:      PASS
  session-mgmt:    PASS
  logout-flow:     PASS
  Genel:           3/3 geçti

Metrikler:
  pass@1: %67 (2/3)
  pass@3: %100 (3/3)

Durum: İNCELEMEYE HAZIR
```

## Entegrasyon Kalıpları

### İmplementasyondan Önce
```
/eval define feature-name
```
`.claude/evals/feature-name.md` konumunda eval tanım dosyası oluşturur

### İmplementasyon Sırasında
```
/eval check feature-name
```
Mevcut eval'ları çalıştırır ve durumu raporlar

### İmplementasyondan Sonra
```
/eval report feature-name
```
Tam eval raporu oluşturur

## Eval Depolama

Eval'ları projede sakla:
```
.claude/
  evals/
    feature-xyz.md      # Eval tanımı
    feature-xyz.log     # Eval çalıştırma geçmişi
    baseline.json       # Regression baseline'ları
```

## En İyi Uygulamalar

1. **Kodlamadan ÖNCE eval'ları tanımla** - Başarı kriterleri hakkında net düşünmeyi zorlar
2. **Eval'ları sık çalıştır** - Regresyonları erken yakala
3. **pass@k'yı zaman içinde izle** - Güvenilirlik trendlerini gözle
4. **Mümkün olduğunda code grader kullan** - Deterministik > olasılıksal
5. **Güvenlik için insan incelemesi** - Güvenlik kontrollerini asla tam otomatikleştirme
6. **Eval'ları hızlı tut** - Yavaş eval'lar çalıştırılmaz
7. **Eval'ları kodla versiyonla** - Eval'lar birinci sınıf artifact'lardır

## Örnek: Kimlik Doğrulama Ekleme

```markdown
## EVAL: add-authentication

### Faz 1: Tanımla (10 dk)
Capability Eval'ları:
- [ ] Kullanıcı email/şifre ile kayıt olabilir
- [ ] Kullanıcı geçerli kimlik bilgileriyle giriş yapabilir
- [ ] Geçersiz kimlik bilgileri uygun hatayla reddedilir
- [ ] Oturumlar sayfa yeniden yüklemelerinde kalıcıdır
- [ ] Logout oturumu temizler

Regression Eval'ları:
- [ ] Halka açık rotalar hala erişilebilir
- [ ] API yanıtları değişmedi
- [ ] Veritabanı şeması uyumlu

### Faz 2: Uygula (değişir)
[Kod yaz]

### Faz 3: Değerlendir
Çalıştır: /eval check add-authentication

### Faz 4: Raporla
EVAL REPORT: add-authentication
==============================
Capability: 5/5 geçti (pass@3: %100)
Regression: 3/3 geçti (pass^3: %100)
Durum: YAYINLA
```

## Product Eval'ları (v1.8)

Davranış kalitesi sadece birim testlerle yakalanamadığında product eval'ları kullan.

### Grader Tipleri

1. Code grader (deterministik assertion'lar)
2. Rule grader (regex/şema kısıtlamaları)
3. Model grader (LLM-as-judge rubric)
4. Human grader (belirsiz çıktılar için manuel karar)

### pass@k Kılavuzu

- `pass@1`: doğrudan güvenilirlik
- `pass@3`: kontrollü yeniden denemeler altında pratik güvenilirlik
- `pass^3`: kararlılık testi (3 çalıştırmanın tümü geçmeli)

Önerilen eşikler:
- Capability eval'ları: pass@3 >= 0.90
- Regression eval'ları: yayın-kritik yollar için pass^3 = 1.00

### Eval Anti-Kalıpları

- Prompt'ları bilinen eval örneklerine overfitting yapmak
- Sadece mutlu-yol çıktılarını ölçmek
- Geçme oranlarını kovalamken maliyet ve gecikme kaymasını görmezden gelmek
- Yayın kapılarında kararsız grader'lara izin vermek

### Minimal Eval Artifact Düzeni

- `.claude/evals/<feature>.md` tanımı
- `.claude/evals/<feature>.log` çalıştırma geçmişi
- `docs/releases/<version>/eval-summary.md` yayın snapshot'ı
