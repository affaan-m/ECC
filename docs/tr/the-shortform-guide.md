# Claude Code'un Her Şeyine Dair Kısa Kılavuz

![Header: Anthropic Hackathon Winner - Tips & Tricks for Claude Code](../assets/images/shortform/00-header.png)

---

**Şubat ayında deneysel kullanıma sunulduğundan beri hevesli bir Claude Code kullanıcısıyım ve [@DRodriguezFX](https://x.com/DRodriguezFX) ile birlikte tamamen Claude Code kullanarak [zenith.chat](https://zenith.chat) projesiyle Anthropic x Forum Ventures hackathon'unu kazandım.**

İşte 10 aylık günlük kullanım sonrası eksiksiz kurulumum: skill'ler, hook'lar, subagent'lar, MCP'ler, plugin'ler ve gerçekten işe yarayanlar.

---

## Skill'ler ve Command'lar

Skill'ler, belirli kapsamlar ve iş akışlarıyla sınırlandırılmış kurallar gibi çalışır. Belirli bir iş akışını yürütmeniz gerektiğinde prompt'lara kısayol görevi görürler.

Opus 4.5 ile uzun bir kodlama oturumundan sonra ölü kodu ve gevşek .md dosyalarını temizlemek mi istiyorsunuz? `/refactor-clean` çalıştırın. Test mi gerekli? `/tdd`, `/e2e`, `/test-coverage`. Skill'ler ayrıca codemap'leri de içerebilir - Claude'un keşfe context harcamadan kod tabanınızda hızlıca gezinmesi için bir yöntem.

![Terminal showing chained commands](../assets/images/shortform/02-chaining-commands.jpeg)
*Command'ları zincirleme*

Command'lar, slash command'lar aracılığıyla yürütülen skill'lerdir. Örtüşürler ancak farklı şekilde saklanırlar:

- **Skill'ler**: `~/.claude/skills/` - daha geniş iş akışı tanımları
- **Command'lar**: `~/.claude/commands/` - hızlı çalıştırılabilir prompt'lar

```bash
# Örnek skill yapısı
~/.claude/skills/
  pmx-guidelines.md      # Projeye özel desenler
  coding-standards.md    # Dile özgü en iyi uygulamalar
  tdd-workflow/          # README.md ile çok dosyalı skill
  security-review/       # Kontrol listesi tabanlı skill
```

---

## Hook'lar

Hook'lar, belirli olaylarda tetiklenen otomasyonlardır. Skill'lerin aksine, araç çağrıları ve yaşam döngüsü olaylarıyla sınırlıdırlar.

**Hook Türleri:**

1. **PreToolUse** - Bir araç çalıştırılmadan önce (doğrulama, hatırlatmalar)
2. **PostToolUse** - Bir araç bittikten sonra (biçimlendirme, geri bildirim döngüleri)
3. **UserPromptSubmit** - Bir mesaj gönderdiğinizde
4. **Stop** - Claude yanıt vermeyi bitirdiğinde
5. **PreCompact** - Context sıkıştırmasından önce
6. **Notification** - İzin istekleri

**Örnek: uzun süren komutlardan önce tmux hatırlatması**

```json
{
  "PreToolUse": [
    {
      "matcher": "tool == \"Bash\" && tool_input.command matches \"(npm|pnpm|yarn|cargo|pytest)\"",
      "hooks": [
        {
          "type": "command",
          "command": "if [ -z \"$TMUX\" ]; then echo '[Hook] Consider tmux for session persistence' >&2; fi"
        }
      ]
    }
  ]
}
```

![PostToolUse hook feedback](../assets/images/shortform/03-posttooluse-hook.png)
*PostToolUse hook çalıştırırken Claude Code'da aldığınız geri bildirimin örneği*

**Pro ipucu:** JSON'u manuel yazmak yerine hook'ları konuşarak oluşturmak için `hookify` plugin'ini kullanın. `/hookify` çalıştırın ve ne istediğinizi açıklayın.

---

## Subagent'lar

Subagent'lar, ana Claude'unuzun (orchestrator) sınırlı kapsamlarla görev devredebileceği süreçlerdir. Arka planda veya ön planda çalışabilir, ana agent için context'i serbest bırakırlar.

Subagent'lar skill'lerle güzel çalışır - skill'lerinizin bir alt kümesini yürütebilen bir subagent'a görevler devredebilir ve bu skill'leri özerk olarak kullanabilir. Ayrıca belirli araç izinleriyle sandbox'lanabilirler.

```bash
# Örnek subagent yapısı
~/.claude/agents/
  planner.md           # Özellik uygulama planlaması
  architect.md         # Sistem tasarım kararları
  tdd-guide.md         # Test odaklı geliştirme
  code-reviewer.md     # Kalite/güvenlik incelemesi
  security-reviewer.md # Güvenlik açığı analizi
  build-error-resolver.md
  e2e-runner.md
  refactor-cleaner.md
```

Uygun kapsam belirleme için her subagent için izin verilen araçları, MCP'leri ve izinleri yapılandırın.

---

## Rule'lar ve Memory

`.rules` klasörünüz, Claude'un HER ZAMAN izlemesi gereken en iyi uygulamaları içeren `.md` dosyalarını barındırır. İki yaklaşım:

1. **Tek CLAUDE.md** - Her şey tek bir dosyada (kullanıcı veya proje seviyesi)
2. **Rules klasörü** - Endişelere göre gruplandırılmış modüler `.md` dosyaları

```bash
~/.claude/rules/
  security.md      # Sabit kodlanmış secret yok, girişleri doğrula
  coding-style.md  # Değişmezlik, dosya organizasyonu
  testing.md       # TDD iş akışı, %80 coverage
  git-workflow.md  # Commit formatı, PR süreci
  agents.md        # Subagent'lara ne zaman delege edilir
  performance.md   # Model seçimi, context yönetimi
```

**Örnek rule'lar:**

- Kod tabanında emoji yok
- Frontend'de mor tonlardan kaçın
- Kodu dağıtmadan önce her zaman test edin
- Mega dosyalar yerine modüler kodu önceliklendirin
- Asla console.log commit etmeyin

---

## MCP'ler (Model Context Protocol)

MCP'ler Claude'u doğrudan harici hizmetlere bağlar. API'lerin yerini tutmaz - bunların etrafında prompt odaklı bir sarmalayıcıdır, bilgide gezinmede daha fazla esneklik sağlar.

**Örnek:** Supabase MCP, Claude'un belirli verileri çekmesine, SQL'i kopyala-yapıştır olmadan doğrudan upstream çalıştırmasına izin verir. Veritabanları, dağıtım platformları vb. için de aynı.

![Supabase MCP listing tables](../assets/images/shortform/04-supabase-mcp.jpeg)
*Supabase MCP'nin public şemasındaki tabloları listeleyen örneği*

**Claude'da Chrome:** Claude'un tarayıcınızı özerk olarak kontrol etmesine izin veren yerleşik bir plugin MCP'sidir - işlerin nasıl çalıştığını görmek için etrafta tıklar.

**KRİTİK: Context Window Yönetimi**

MCP'lerle seçici olun. Tüm MCP'leri kullanıcı yapılandırmasında tutarım ancak **kullanılmayan her şeyi devre dışı bırakırım**. `/plugins`'e gidin ve aşağı kaydırın veya `/mcp` çalıştırın.

![/plugins interface](../assets/images/shortform/05-plugins-interface.jpeg)
*/plugins kullanarak MCP'lere giderek şu anda hangi MCP'lerin yüklü olduğunu ve durumlarını görme*

Sıkıştırmadan önce 200k context window'unuz, çok fazla araç etkinleştirilmişse sadece 70k olabilir. Performans önemli ölçüde düşer.

**Genel kural:** Yapılandırmada 20-30 MCP bulundurun, ancak 10'dan az etkin / 80'den az aktif araç tutun.

```bash
# Etkin MCP'leri kontrol edin
/mcp

# ~/.claude.json içinde projects.disabledMcpServers altında kullanılmayanları devre dışı bırakın
```

---

## Plugin'ler

Plugin'ler, sıkıcı manuel kurulum yerine kolay kurulum için araçları paketler. Bir plugin, birleştirilmiş bir skill + MCP veya birlikte paketlenmiş hook'lar/araçlar olabilir.

**Plugin'leri yükleme:**

```bash
# Bir marketplace ekleyin
# @mixedbread-ai tarafından mgrep plugin
claude plugin marketplace add https://github.com/mixedbread-ai/mgrep

# Claude'u açın, /plugins çalıştırın, yeni marketplace'i bulun, oradan yükleyin
```

![Marketplaces tab showing mgrep](../assets/images/shortform/06-marketplaces-mgrep.jpeg)
*Yeni yüklenen Mixedbread-Grep marketplace'i gösterme*

**LSP Plugin'leri**, Claude Code'u sık sık editör dışında çalıştırıyorsanız özellikle kullanışlıdır. Language Server Protocol, Claude'a IDE açık olmadan gerçek zamanlı tip kontrolü, tanıma gitme ve akıllı tamamlamalar verir.

```bash
# Etkin plugin'ler örneği
typescript-lsp@claude-plugins-official  # TypeScript zekası
pyright-lsp@claude-plugins-official     # Python tip kontrolü
hookify@claude-plugins-official         # Hook'ları konuşarak oluşturma
mgrep@Mixedbread-Grep                   # ripgrep'ten daha iyi arama
```

MCP'lerle aynı uyarı - context window'unuzu izleyin.

---

## İpuçları ve Püf Noktaları

### Klavye Kısayolları

- `Ctrl+U` - Tüm satırı sil (backspace spam'inden daha hızlı)
- `!` - Hızlı bash komutu öneki
- `@` - Dosya arama
- `/` - Slash command'ları başlatma
- `Shift+Enter` - Çok satırlı girdi
- `Tab` - Düşünme görüntüsünü değiştir
- `Esc Esc` - Claude'u kesme / kodu geri yükleme

### Paralel İş Akışları

- **Fork** (`/fork`) - Paralelde çakışmayan görevler yapmak için sıraya alınan mesaj spam'i yerine konuşmaları fork'layın
- **Git Worktree'ler** - Çakışma olmadan paralel Claude'lar için örtüşen iş. Her worktree bağımsız bir checkout'tur

```bash
git worktree add ../feature-branch feature-branch
# Şimdi her worktree'de ayrı Claude instance'ları çalıştırın
```

### Uzun Süren Komutlar için tmux

Claude'un çalıştırdığı log'ları/bash süreçlerini stream edin ve izleyin:

<https://github.com/user-attachments/assets/shortform/07-tmux-video.mp4>

```bash
tmux new -s dev
# Claude burada komutlar çalıştırır, ayrılıp yeniden bağlanabilirsiniz
tmux attach -t dev
```

### mgrep > grep

`mgrep`, ripgrep/grep'ten önemli bir gelişmedir. Plugin marketplace aracılığıyla yükleyin, ardından `/mgrep` skill'ini kullanın. Hem yerel arama hem de web aramasıyla çalışır.

```bash
mgrep "function handleSubmit"  # Yerel arama
mgrep --web "Next.js 15 app router changes"  # Web araması
```

### Diğer Kullanışlı Command'lar

- `/rewind` - Önceki bir duruma geri dön
- `/statusline` - Branch, context %, todo'larla özelleştir
- `/checkpoints` - Dosya seviyesi geri alma noktaları
- `/compact` - Context sıkıştırmasını manuel olarak tetikle

### GitHub Actions CI/CD

PR'larınızda GitHub Actions ile kod incelemesi kurun. Claude yapılandırıldığında PR'ları otomatik olarak inceleyebilir.

![Claude bot approving a PR](../assets/images/shortform/08-github-pr-review.jpeg)
*Claude bir bug düzeltme PR'ını onaylıyor*

### Sandboxing

Riskli işlemler için sandbox modunu kullanın - Claude gerçek sisteminizi etkilemeden kısıtlı ortamda çalışır.

---

## Editörler Hakkında

Editör seçiminiz Claude Code iş akışını önemli ölçüde etkiler. Claude Code herhangi bir terminalden çalışırken, yetenekli bir editörle eşleştirmek gerçek zamanlı dosya takibi, hızlı gezinme ve entegre komut yürütme sağlar.

### Zed (Benim Tercihim)

Ben [Zed](https://zed.dev) kullanıyorum - Rust ile yazılmış, bu nedenle gerçekten hızlı. Anında açılır, büyük kod tabanlarını terletmeden işler ve sistem kaynaklarına zar zor dokunur.

**Neden Zed + Claude Code harika bir kombinasyon:**

- **Hız** - Rust tabanlı performans, Claude hızla dosyaları düzenlediğinde gecikme olmadığı anlamına gelir. Editörünüz ayak uydurur
- **Agent Panel Entegrasyonu** - Zed'in Claude entegrasyonu, Claude düzenlerken dosya değişikliklerini gerçek zamanlı takip etmenizi sağlar. Editörü terk etmeden Claude'un referans verdiği dosyalar arasında geçiş yapın
- **CMD+Shift+R Command Palette** - Tüm özel slash command'larınıza, debugger'larınıza, aranabilir bir UI'da build script'lerinize hızlı erişim
- **Minimal Kaynak Kullanımı** - Ağır işlemler sırasında Claude ile RAM/CPU için rekabet etmez. Opus çalıştırırken önemli
- **Vim Modu** - Bu sizin tarzınızsa tam vim keybinding'leri

![Zed Editor with custom commands](../assets/images/shortform/09-zed-editor.jpeg)
*CMD+Shift+R kullanarak özel komutlar açılır menüsü olan Zed Editor. Following modu sağ altta hedef işareti olarak gösterilmiş.*

**Editörden Bağımsız İpuçları:**

1. **Ekranınızı bölün** - Bir tarafta Claude Code ile terminal, diğer tarafta editör
2. **Ctrl + G** - Claude'un üzerinde çalıştığı dosyayı Zed'de hızlıca açın
3. **Otomatik kaydetme** - Otomatik kaydetmeyi etkinleştirin böylece Claude'un dosya okumaları her zaman güncel olur
4. **Git entegrasyonu** - Claude'un değişikliklerini commit etmeden önce incelemek için editörün git özelliklerini kullanın
5. **Dosya izleyiciler** - Çoğu editör değiştirilen dosyaları otomatik yeniden yükler, bunun etkin olduğunu doğrulayın

### VSCode / Cursor

Bu da geçerli bir seçimdir ve Claude Code ile iyi çalışır. LSP işlevselliğini etkinleştiren `\ide` ile editörünüzle otomatik senkronizasyon ile terminal formatında kullanabilirsiniz (artık plugin'lerle biraz gereksiz). Veya Editor ile daha entegre olan ve eşleşen bir UI'ya sahip extension'ı tercih edebilirsiniz.

![VS Code Claude Code Extension](../assets/images/shortform/10-vscode-extension.jpeg)
*VS Code extension, doğrudan IDE'nize entegre edilmiş Claude Code için native bir grafik arayüz sağlar.*

---

## Benim Kurulumum

### Plugin'ler

**Yüklü:** (Genellikle bunlardan sadece 4-5'i aynı anda etkin tutuluyor)

```markdown
ralph-wiggum@claude-code-plugins       # Loop otomasyonu
frontend-patterns@claude-code-plugins  # UI/UX desenleri
commit-commands@claude-code-plugins    # Git iş akışı
security-guidance@claude-code-plugins  # Güvenlik kontrolleri
pr-review-toolkit@claude-code-plugins  # PR otomasyonu
typescript-lsp@claude-plugins-official # TS zekası
hookify@claude-plugins-official        # Hook oluşturma
code-simplifier@claude-plugins-official
feature-dev@claude-code-plugins
explanatory-output-style@claude-code-plugins
code-review@claude-code-plugins
context7@claude-plugins-official       # Canlı dokümantasyon
pyright-lsp@claude-plugins-official    # Python tipleri
mgrep@Mixedbread-Grep                  # Daha iyi arama
```

### MCP Server'ları

**Yapılandırılmış (Kullanıcı Seviyesi):**

```json
{
  "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
  "firecrawl": { "command": "npx", "args": ["-y", "firecrawl-mcp"] },
  "supabase": {
    "command": "npx",
    "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=YOUR_REF"]
  },
  "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] },
  "sequential-thinking": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
  },
  "vercel": { "type": "http", "url": "https://mcp.vercel.com" },
  "railway": { "command": "npx", "args": ["-y", "@railway/mcp-server"] },
  "cloudflare-docs": { "type": "http", "url": "https://docs.mcp.cloudflare.com/mcp" },
  "cloudflare-workers-bindings": {
    "type": "http",
    "url": "https://bindings.mcp.cloudflare.com/mcp"
  },
  "clickhouse": { "type": "http", "url": "https://mcp.clickhouse.cloud/mcp" },
  "AbletonMCP": { "command": "uvx", "args": ["ableton-mcp"] },
  "magic": { "command": "npx", "args": ["-y", "@magicuidesign/mcp@latest"] }
}
```

Bu anahtar - 14 MCP yapılandırılmış ancak proje başına sadece ~5-6'sı etkin. Context window'u sağlıklı tutar.

### Ana Hook'lar

```json
{
  "PreToolUse": [
    { "matcher": "npm|pnpm|yarn|cargo|pytest", "hooks": ["tmux reminder"] },
    { "matcher": "Write && .md file", "hooks": ["block unless README/CLAUDE"] },
    { "matcher": "git push", "hooks": ["open editor for review"] }
  ],
  "PostToolUse": [
    { "matcher": "Edit && .ts/.tsx/.js/.jsx", "hooks": ["prettier --write"] },
    { "matcher": "Edit && .ts/.tsx", "hooks": ["tsc --noEmit"] },
    { "matcher": "Edit", "hooks": ["grep console.log warning"] }
  ],
  "Stop": [
    { "matcher": "*", "hooks": ["check modified files for console.log"] }
  ]
}
```

### Özel Status Line

Kullanıcı, dizin, kirli göstergeli git branch, kalan context %, model, zaman ve todo sayısını gösterir:

![Custom status line](../assets/images/shortform/11-statusline.jpeg)
*Mac root dizinimde örnek statusline*

```
affoon:~ ctx:65% Opus 4.5 19:52
▌▌ plan mode on (shift+tab to cycle)
```

### Rules Yapısı

```
~/.claude/rules/
  security.md      # Zorunlu güvenlik kontrolleri
  coding-style.md  # Değişmezlik, dosya boyutu limitleri
  testing.md       # TDD, %80 coverage
  git-workflow.md  # Conventional commit'ler
  agents.md        # Subagent delegasyon kuralları
  patterns.md      # API yanıt formatları
  performance.md   # Model seçimi (Haiku vs Sonnet vs Opus)
  hooks.md         # Hook dokümantasyonu
```

### Subagent'lar

```
~/.claude/agents/
  planner.md           # Özellikleri parçalara ayırma
  architect.md         # Sistem tasarımı
  tdd-guide.md         # Önce testleri yaz
  code-reviewer.md     # Kalite incelemesi
  security-reviewer.md # Güvenlik açığı taraması
  build-error-resolver.md
  e2e-runner.md        # Playwright testleri
  refactor-cleaner.md  # Ölü kod kaldırma
  doc-updater.md       # Dokümantasyonu senkronize tut
```

---

## Temel Çıkarımlar

1. **Aşırı karmaşıklaştırmayın** - yapılandırmayı mimari değil, ince ayar gibi ele alın
2. **Context window değerlidir** - kullanılmayan MCP'leri ve plugin'leri devre dışı bırakın
3. **Paralel yürütme** - konuşmaları fork'layın, git worktree'leri kullanın
4. **Tekrarlananları otomatikleştirin** - biçimlendirme, linting, hatırlatmalar için hook'lar
5. **Subagent'larınızı kapsamlandırın** - sınırlı araçlar = odaklanmış yürütme

---

## Referanslar

- [Plugin'ler Referansı](https://code.claude.com/docs/en/plugins-reference)
- [Hook'lar Dokümantasyonu](https://code.claude.com/docs/en/hooks)
- [Checkpoint'leme](https://code.claude.com/docs/en/checkpointing)
- [Interactive Mode](https://code.claude.com/docs/en/interactive-mode)
- [Memory Sistemi](https://code.claude.com/docs/en/memory)
- [Subagent'lar](https://code.claude.com/docs/en/sub-agents)
- [MCP Genel Bakış](https://code.claude.com/docs/en/mcp-overview)

---

**Not:** Bu bir detay alt kümesidir. Gelişmiş desenler için [Longform Kılavuzu](./the-longform-guide.md)'na bakın.

---

*NYC'de [@DRodriguezFX](https://x.com/DRodriguezFX) ile [zenith.chat](https://zenith.chat) oluşturarak Anthropic x Forum Ventures hackathon'unu kazandım*
