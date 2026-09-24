# Claude Code'un Her Şeyine Dair Uzun Kılavuz

![Header: The Longform Guide to Everything Claude Code](../../assets/images/longform/01-header.png)

---

> **Ön Koşul**: Bu kılavuz [Claude Code'un Her Şeyine Dair Kısa Kılavuz](./the-shortform-guide.md) üzerine kuruludur. Skill'leri, hook'ları, subagent'ları, MCP'leri ve plugin'leri henüz kurmadıysanız önce onu okuyun.

![Reference to Shorthand Guide](../../assets/images/longform/02-shortform-reference.png)
*Kısa Kılavuz - önce onu okuyun*

Kısa kılavuzda, temel kurulumu ele aldım: etkili bir Claude Code iş akışının omurgasını oluşturan skill'ler ve command'lar, hook'lar, subagent'lar, MCP'ler, plugin'ler ve yapılandırma desenleri. Bu kurulum kılavuzu ve temel altyapıydı.

Bu uzun kılavuz, verimli oturumları israf olanlardan ayıran tekniklere giriyor. Kısa kılavuzu okumadıysanız, geri dönün ve önce yapılandırmalarınızı kurun. Bundan sonra gelen, skill'lerin, agent'ların, hook'ların ve MCP'lerin zaten yapılandırılmış ve çalışır durumda olduğunu varsayar.

Buradaki temalar: token ekonomisi, memory kalıcılığı, doğrulama desenleri, paralelleştirme stratejileri ve yeniden kullanılabilir iş akışları oluşturmanın bileşik etkileri. Bunlar, ilk saat içinde context çürümesiyle rahatsız edilme ile saatlerce üretken oturumları sürdürme arasındaki farkı yaratan, 10+ aylık günlük kullanımda geliştirdiğim desenlerdir.

Kısa ve uzun kılavuzlarda ele alınan her şey GitHub'da mevcuttur: `github.com/affaan-m/everything-claude-code`

---

## İpuçları ve Püf Noktaları

### Bazı MCP'ler Değiştirilebilir ve Context Window'unuzu Serbest Bırakır

Sürüm kontrol (GitHub), veritabanları (Supabase), dağıtım (Vercel, Railway) vb. gibi MCP'ler için - bu platformların çoğu zaten MCP'nin esasen sadece sardığı sağlam CLI'lara sahiptir. MCP güzel bir sarmalayıcıdır ancak bir maliyeti vardır.

CLI'nin MCP'yi gerçekten kullanmadan (ve bununla birlikte gelen azalmış context window olmadan) daha çok bir MCP gibi işlev görmesi için, işlevselliği skill'lere ve command'lara paketlemeyi düşünün. MCP'nin işleri kolaylaştıran maruz ettiği araçları çıkarın ve bunları command'lara dönüştürün.

Örnek: GitHub MCP'yi her zaman yüklü tutmak yerine, tercih ettiğiniz seçeneklerle `gh pr create`'i sarmalayan bir `/gh-pr` command'ı oluşturun. Supabase MCP'nin context yemesi yerine, Supabase CLI'sini doğrudan kullanan skill'ler oluşturun.

Lazy loading ile, context window sorunu çoğunlukla çözülmüştür. Ancak token kullanımı ve maliyet aynı şekilde çözülmemiştir. CLI + skill'ler yaklaşımı hala bir token optimizasyon yöntemidir.

---

## ÖNEMLİ ŞEYLER

### Context ve Memory Yönetimi

Oturumlar arasında memory paylaşımı için, ilerlemeyi özetleyen ve kontrol eden, ardından `.claude` klasörünüzde bir `.tmp` dosyasına kaydeden ve oturumunuz sonuna kadar ona ekleyen bir skill veya command en iyi bahistir. Ertesi gün bunu context olarak kullanabilir ve kaldığı yerden devam edebilir, her oturum için yeni bir dosya oluşturun böylece eski context'i yeni işe kirletmezsiniz.

![Session Storage File Tree](../../assets/images/longform/03-session-storage.png)
*Oturum depolama örneği -> <https://github.com/affaan-m/everything-claude-code/tree/main/examples/sessions>*

Claude mevcut durumu özetleyen bir dosya oluşturur. İnceleyin, gerekirse düzenlemeler isteyin, ardından yeniden başlayın. Yeni konuşma için, sadece dosya yolunu sağlayın. Özellikle context limitlerini aşarken ve karmaşık işi sürdürmeniz gerektiğinde kullanışlıdır. Bu dosyalar şunları içermelidir:
- Hangi yaklaşımların işe yaradığı (kanıtla doğrulanabilir)
- Hangi yaklaşımların denendiği ancak işe yaramadığı
- Hangi yaklaşımların denenmediği ve ne yapılması gerektiği

**Context'i Stratejik Olarak Temizleme:**

Planınız hazır ve context temizlendiğinde (artık Claude Code'da plan modunda varsayılan seçenek), plandan çalışabilirsiniz. Bu, yürütmeyle artık ilgili olmayan çok fazla keşif context'i biriktirdiğinizde kullanışlıdır. Stratejik sıkıştırma için, otomatik sıkıştırmayı devre dışı bırakın. Mantıksal aralıklarla manuel olarak sıkıştırın veya bunu sizin için yapan bir skill oluşturun.

**Gelişmiş: Dinamik System Prompt Enjeksiyonu**

Aldığım bir desen: her oturumu yükleyen CLAUDE.md'ye (kullanıcı kapsamı) veya `.claude/rules/`'a (proje kapsamı) her şeyi sadece koymak yerine, context'i dinamik olarak enjekte etmek için CLI flag'lerini kullanın.

```bash
claude --system-prompt "$(cat memory.md)"
```

Bu, ne zaman hangi context'in yüklendiği konusunda daha hassas olmanızı sağlar. System prompt içeriği, kullanıcı mesajlarından daha yüksek yetkiye sahiptir, kullanıcı mesajları da araç sonuçlarından daha yüksek yetkiye sahiptir.

**Pratik kurulum:**

```bash
# Günlük geliştirme
alias claude-dev='claude --system-prompt "$(cat ~/.claude/contexts/dev.md)"'

# PR inceleme modu
alias claude-review='claude --system-prompt "$(cat ~/.claude/contexts/review.md)"'

# Araştırma/keşif modu
alias claude-research='claude --system-prompt "$(cat ~/.claude/contexts/research.md)"'
```

**Gelişmiş: Memory Persistence Hook'ları**

Çoğu insanın memory ile ilgili bilmediği hook'lar var:

- **PreCompact Hook**: Context sıkıştırması gerçekleşmeden önce, önemli durumu bir dosyaya kaydedin
- **Stop Hook (Oturum Sonu)**: Oturum sonunda, öğrenmeleri bir dosyaya kalıcı hale getirin
- **SessionStart Hook**: Yeni oturumda, önceki context'i otomatik yükleyin

Bu hook'ları oluşturdum ve repo'da `github.com/affaan-m/everything-claude-code/tree/main/hooks/memory-persistence` adresindeler

---

### Sürekli Öğrenme / Memory

Bir prompt'u birden çok kez tekrarlamanız gerekti ve Claude aynı probleme takıldı veya daha önce duyduğunuz bir yanıt verdi - bu desenlerin skill'lere eklenmesi gerekir.

**Problem:** Boşa giden token'lar, boşa giden context, boşa giden zaman.

**Çözüm:** Claude Code önemsiz olmayan bir şey keşfettiğinde - bir hata ayıklama tekniği, bir geçici çözüm, projeye özgü bir desen - bu bilgiyi yeni bir skill olarak kaydeder. Benzer bir problem bir dahaki sefer ortaya çıktığında, skill otomatik olarak yüklenir.

Bunu yapan bir sürekli öğrenme skill'i oluşturdum: `github.com/affaan-m/everything-claude-code/tree/main/skills/continuous-learning`

**Neden Stop Hook (UserPromptSubmit Değil):**

Anahtar tasarım kararı, UserPromptSubmit yerine **Stop hook** kullanmaktır. UserPromptSubmit her mesajda çalışır - her prompt'a gecikme ekler. Stop oturum sonunda bir kez çalışır - hafiftir, oturum sırasında sizi yavaşlatmaz.

---

### Token Optimizasyonu

**Birincil Strateji: Subagent Mimarisi**

Kullandığınız araçları optimize edin ve görev için yeterli olan en ucuz modeli devretmek üzere tasarlanmış subagent mimarisi.

**Model Seçimi Hızlı Referans:**

![Model Selection Table](../../assets/images/longform/04-model-selection.png)
*Çeşitli yaygın görevlerde subagent'ların varsayımsal kurulumu ve seçimlerin arkasındaki akıl yürütme*

| Görev Türü                    | Model  | Neden                                            |
| ----------------------------- | ------ | ------------------------------------------------ |
| Keşif/arama                   | Haiku  | Hızlı, ucuz, dosya bulmak için yeterince iyi    |
| Basit düzenlemeler            | Haiku  | Tek dosya değişiklikleri, net talimatlar        |
| Çok dosyalı uygulama          | Sonnet | Kodlama için en iyi denge                        |
| Karmaşık mimari               | Opus   | Derin akıl yürütme gerekli                       |
| PR incelemeleri               | Sonnet | Context'i anlar, nüansı yakalar                  |
| Güvenlik analizi              | Opus   | Güvenlik açıklarını kaçırmayı göze alamaz        |
| Doküman yazma                 | Haiku  | Yapı basittir                                    |
| Karmaşık bug'ları hata ayıklama | Opus | Tüm sistemi aklında tutması gerekir              |

Kodlama görevlerinin %90'ı için Sonnet'i varsayılan yapın. İlk deneme başarısız olduğunda, görev 5+ dosyaya yayıldığında, mimari kararlar veya güvenlik açısından kritik kod için Opus'a yükseltin.

**Fiyatlandırma Referansı:**

![Claude Model Pricing](../../assets/images/longform/05-pricing-table.png)
*Kaynak: <https://platform.claude.com/docs/en/about-claude/pricing>*

**Araca Özgü Optimizasyonlar:**

grep'i mgrep ile değiştirin - geleneksel grep veya ripgrep'e kıyasla ortalama ~%50 token azaltması:

![mgrep Benchmark](../../assets/images/longform/06-mgrep-benchmark.png)
*50 görevlik benchmark'ımızda, mgrep + Claude Code, grep tabanlı iş akışlarına kıyasla benzer veya daha iyi değerlendirilen kalitede ~2 kat daha az token kullandı. Kaynak: @mixedbread-ai tarafından mgrep*

**Modüler Kod Tabanı Faydaları:**

Ana dosyaların binlerce satır yerine yüzlerce satırda olduğu daha modüler bir kod tabanına sahip olmak, hem token optimizasyon maliyetlerinde hem de bir görevi ilk seferde doğru yapmada yardımcı olur.

---

### Doğrulama Döngüleri ve Eval'lar

**Benchmarking İş Akışı:**

Aynı şeyi bir skill ile ve olmadan istemek ve çıktı farkını kontrol etmek arasında karşılaştırma yapın:

Konuşmayı fork'layın, bunlardan birinde skill olmadan yeni bir worktree başlatın, sonunda bir diff çekin, neyin log'landığını görün.

**Eval Desen Türleri:**

- **Checkpoint Tabanlı Eval'lar**: Açık checkpoint'ler belirleyin, tanımlı kriterlere karşı doğrulayın, devam etmeden önce düzeltin
- **Sürekli Eval'lar**: Her N dakikada bir veya büyük değişikliklerden sonra çalıştırın, tam test paketi + lint

**Anahtar Metrikler:**

```
pass@k: k denemeden EN AZ BİRİ başarılı olur
        k=1: %70  k=3: %91  k=5: %97

pass^k: TÜM k denemeler başarılı olmalıdır
        k=1: %70  k=3: %34  k=5: %17
```

Sadece işe yaraması gerektiğinde **pass@k** kullanın. Tutarlılık gerekli olduğunda **pass^k** kullanın.

---

## PARALELLEŞTİRME

Çoklu Claude terminal kurulumunda konuşmaları fork'larken, fork ve orijinal konuşmadaki eylemler için kapsamın iyi tanımlandığından emin olun. Kod değişiklikleri söz konusu olduğunda minimum örtüşme hedefleyin.

**Tercih Ettiğim Desen:**

Kod değişiklikleri için ana sohbet, kod tabanı ve mevcut durumu hakkında sorular veya harici hizmetler hakkında araştırma için fork'lar.

**Keyfi Terminal Sayıları Üzerine:**

![Boris on Parallel Terminals](../../assets/images/longform/07-boris-parallel.png)
*Boris (Anthropic) birden fazla Claude instance'ı çalıştırma üzerine*

Boris'in paralelleştirme hakkında ipuçları var. 5 Claude instance'ını yerel olarak ve 5'ini upstream çalıştırmak gibi şeyler önerdi. Keyfi terminal miktarları belirlemeye karşı tavsiyede bulunurum. Bir terminalin eklenmesi gerçek bir zorunluluktan olmalıdır.

Hedefiniz şu olmalı: **minimum uygulanabilir paralelleştirme miktarıyla ne kadar iş yapabilirsiniz.**

**Paralel Instance'lar için Git Worktree'ler:**

```bash
# Paralel iş için worktree'ler oluşturun
git worktree add ../project-feature-a feature-a
git worktree add ../project-feature-b feature-b
git worktree add ../project-refactor refactor-branch

# Her worktree kendi Claude instance'ını alır
cd ../project-feature-a && claude
```

Instance'larınızı ölçeklendirmeye başlıyorsanız VE birbirleriyle örtüşen kod üzerinde çalışan birden fazla Claude instance'ınız varsa, git worktree'leri kullanmanız ve her biri için çok iyi tanımlanmış bir plana sahip olmanız zorunludur. Tüm sohbetlerinizi adlandırmak için `/rename <name here>` kullanın.

![Two Terminal Setup](../../assets/images/longform/08-two-terminals.png)
*Başlangıç Kurulumu: Kodlama için Sol Terminal, Sorular için Sağ Terminal - /rename ve /fork kullanın*

**Cascade Yöntemi:**

Birden fazla Claude Code instance'ı çalıştırırken, "cascade" deseniyle organize edin:

- Yeni görevleri sağdaki yeni sekmelerde açın
- Soldan sağa süpürün, en eskiden en yeniye
- Aynı anda en fazla 3-4 göreve odaklanın

---

## TEMEL İŞLER

**İki Instance Başlangıç Deseni:**

Kendi iş akışı yönetimim için, boş bir repo'yu 2 açık Claude instance'ıyla başlatmayı seviyorum.

**Instance 1: Scaffolding Agent**
- İskeleyi ve temelleri atar
- Proje yapısını oluşturur
- Yapılandırmaları kurar (CLAUDE.md, rules, agents)

**Instance 2: Deep Research Agent**
- Tüm hizmetlerinize bağlanır, web araması
- Detaylı PRD oluşturur
- Mimari mermaid diyagramları oluşturur
- Gerçek dokümantasyon klipleriyle referansları derler

**llms.txt Deseni:**

Mevcutsa, doküman sayfalarına ulaştıktan sonra üzerlerinde `/llms.txt` yaparak birçok dokümantasyon referansında bir `llms.txt` bulabilirsiniz. Bu size dokümantasyonun temiz, LLM için optimize edilmiş bir versiyonunu verir.

**Felsefe: Yeniden Kullanılabilir Desenler Oluşturun**

@omarsar0'dan: "Erken dönemde, yeniden kullanılabilir iş akışları/desenler oluşturmaya zaman harcadım. Oluşturması sıkıcı, ancak model'ler ve agent harness'leri geliştikçe bunun çılgın bir bileşik etkisi oldu."

**Yatırım yapılacaklar:**

- Subagent'lar
- Skill'ler
- Command'lar
- Planlama desenleri
- MCP araçları
- Context mühendisliği desenleri

---

## Agent'lar ve Sub-Agent'lar için En İyi Uygulamalar

**Sub-Agent Context Problemi:**

Sub-agent'lar her şeyi dökmek yerine özet döndürerek context tasarrufu sağlamak için vardır. Ancak orchestrator'ın sub-agent'ın eksik olduğu anlamsal context'i vardır. Sub-agent sadece gerçek sorguyu bilir, isteğin arkasındaki AMACI değil.

**Yinelemeli Alma Deseni:**

1. Orchestrator her sub-agent dönüşünü değerlendirir
2. Kabul etmeden önce takip soruları sorun
3. Sub-agent kaynağa geri döner, cevapları alır, döner
4. Yeterli olana kadar döngü (max 3 döngü)

**Anahtar:** Sadece sorguyu değil, amaç context'ini iletin.

**Sıralı Fazlarla Orchestrator:**

```markdown
Faz 1: ARAŞTIRMA (Explore agent'ı kullan) → research-summary.md
Faz 2: PLAN (planner agent'ı kullan) → plan.md
Faz 3: UYGULAMA (tdd-guide agent'ı kullan) → kod değişiklikleri
Faz 4: İNCELEME (code-reviewer agent'ı kullan) → review-comments.md
Faz 5: DOĞRULAMA (gerekirse build-error-resolver kullan) → bitti veya geri döngü
```

**Anahtar kurallar:**

1. Her agent BİR net girdi alır ve BİR net çıktı üretir
2. Çıktılar bir sonraki faz için girdi olur
3. Asla fazları atlamayın
4. Agent'lar arasında `/clear` kullanın
5. Ara çıktıları dosyalarda saklayın

---

## EĞLENCELİ ŞEYLER / KRİTİK DEĞİL SADECE EĞLENCELİ İPUÇLARI

### Özel Status Line

`/statusline` kullanarak ayarlayabilirsiniz - ardından Claude birinin olmadığını söyleyecek ancak sizin için kurabilir ve içinde ne istediğinizi soracak.

Ayrıca bakın: ccstatusline (özel Claude Code status line'ları için topluluk projesi)

### Ses Transkripsiyon

Claude Code ile sesinizle konuşun. Birçok insan için yazmaktan daha hızlı.

- Mac'te superwhisper, MacWhisper
- Transkripsiyon hataları olsa bile, Claude amacı anlar

### Terminal Alias'ları

```bash
alias c='claude'
alias gb='github'
alias co='code'
alias q='cd ~/Desktop/projects'
```

---

## Kilometre Taşı

![25k+ GitHub Stars](../../assets/images/longform/09-25k-stars.png)
*Bir haftadan kısa sürede 25.000+ GitHub yıldızı*

---

## Kaynaklar

**Agent Orkestrasyon:**

- claude-flow — 54+ özelleşmiş agent ile topluluk tarafından oluşturulmuş kurumsal orkestrasyon platformu

**Kendini Geliştiren Memory:**

- Bu repo'da `skills/continuous-learning/`'e bakın
- rlancemartin.github.io/2025/12/01/claude_diary/ - Oturum yansıma deseni

**System Prompt'ları Referansı:**

- system-prompts-and-models-of-ai-tools — AI system prompt'larının topluluk koleksiyonu (110k+ yıldız)

**Resmi:**

- Anthropic Academy: anthropic.skilljar.com

---

## Referanslar

- [Anthropic: AI agent'ları için eval'ların gizemini çözme](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [YK: 32 Claude Code İpucu](https://agenticcoding.substack.com/p/32-claude-code-tips-from-basics-to)
- [RLanceMartin: Oturum Yansıma Deseni](https://rlancemartin.github.io/2025/12/01/claude_diary/)
- @PerceptualPeak: Sub-Agent Context Müzakeresi
- @menhguin: Agent Soyutlamaları Seviye Listesi
- @omarsar0: Bileşik Etkiler Felsefesi

---

*Her iki kılavuzda ele alınan her şey GitHub'da [everything-claude-code](https://github.com/affaan-m/everything-claude-code) adresinde mevcuttur*
