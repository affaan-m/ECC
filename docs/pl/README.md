**Język:** [English](../../README.md) | **Polski** | [Deutsch](../de-DE/README.md) | [Español](../es/README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md) | [Українська](../uk-UA/README.md)

# ECC

![ECC — system operacyjny dla pracy agentowej, natywny dla środowisk agentów](../../assets/hero.png)

> Tłumaczenie obejmuje przewodnik startowy i najważniejsze powierzchnie ECC. Źródło angielskie:
> commit `8321021c54d670126ce3b2969d5deb880b4b0c2a` z gałęzi `main`.
> Pełny, aktualny katalog pozostaje w [angielskim README](../../README.md); kolejne obszary będą
> tłumaczone etapami, aby ograniczyć rozmiar i ryzyko nieaktualnych zmian.

---

**Natywny dla środowisk agentów system operacyjny do pracy agentowej.**

ECC to nie tylko zestaw konfiguracji. Łączy gotowe do użycia Agenty, Skille, Hooki, Rules,
konfiguracje MCP i warstwę zgodności ze starszymi Commands. System powstał na podstawie
rzeczywistych przepływów pracy i działa w wielu środowiskach: **Claude Code**, **Codex**,
**Cursor**, **OpenCode**, **Gemini**, **Zed**, **GitHub Copilot** i innych.

## Oficjalne źródła

Instaluj ECC wyłącznie ze zweryfikowanych kanałów:

- repozytorium [github.com/affaan-m/ECC](https://github.com/affaan-m/ECC),
- pakiety npm [`ecc-universal`](https://www.npmjs.com/package/ecc-universal) i
  [`ecc-agentshield`](https://www.npmjs.com/package/ecc-agentshield),
- aplikacja [ECC Tools dla GitHub](https://github.com/apps/ecc-tools),
- identyfikator pluginu `ecc@ecc`,
- witryna [ecc.tools](https://ecc.tools).

Nieoficjalne kopie i mirrory nie są utrzymywane ani sprawdzane przez projekt.

## Szybki start

Wybierz **jedną** ścieżkę instalacji. Łączenie instalacji pluginu z pełną instalacją ręczną
jest najczęstszą przyczyną zduplikowanych Agentów, Skilli i Hooków.

### Uniwersalna konfiguracja prowadzona

```bash
npx ecc-universal@2.2.1 setup
```

Możesz także użyć właściwego menedżera pakietów:

```bash
pnpm dlx ecc-universal@2.2.1 setup
yarn dlx ecc-universal@2.2.1 setup
bunx ecc-universal@2.2.1 setup
```

Przed uruchomieniem kodu pakietu sprawdź źródło wydania i integralność rejestru.

### Claude Code

W Claude Code dodaj marketplace i zainstaluj plugin:

```text
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
```

Następnie zacznij od `rules/common` oraz tylko tych pakietów językowych lub frameworków,
których rzeczywiście używasz. Po instalacji pluginu nie uruchamiaj dodatkowo pełnego
`./install.sh --profile full`.

### Codex

```bash
codex plugin marketplace add affaan-m/ECC
codex plugin add ecc@ecc
```

W Codex użyj `$configure-ecc`, aby przejść przez konfigurację dostosowaną do dostawcy.

### Inne środowiska

Polecenia uruchamiaj z głównego katalogu pobranego repozytorium. Wiersz OpenCode wybiera
pełny profil i jawnie włącza automatyczne Hooki.

| Środowisko | Polecenie instalacji z repozytorium |
|---|---|
| Cursor | `./install.sh --profile minimal --target cursor` |
| Gemini CLI | `./install.sh --profile minimal --target gemini` |
| Zed | `./install.sh --profile minimal --target zed` |
| OpenCode | `npm install && npm run build:opencode && ./install.sh --profile full --target opencode --enable-hooks` |
| Hermes | `./install.sh --profile minimal --target hermes` |
| OpenClaw | `./install.sh --profile minimal --target openclaw` |
| Kimi Code CLI | `./install.sh --profile minimal --target kimi` |

Pełna macierz środowisk i wymagania znajdują się w
[angielskiej sekcji Platform Support](../../README.md#platform-support).

## Instalacja polskiej dokumentacji

Polski używa kodu `pl`; akceptowany jest także alias `pl-PL`. Użyj lokalnej kopii
repozytorium zawierającej katalog `docs/pl/` i komponent `locale:pl`. Uruchom poniższe
polecenia z głównego katalogu tej kopii, po zainstalowaniu zależności repozytorium.
Wymagany jest Node.js 18 lub nowszy. Wydanie `ecc-universal@2.2.1` nie zawiera jeszcze
polskiej dokumentacji.

Najpierw sprawdź plan bez zapisywania plików instalacji:

```bash
node scripts/install-apply.js --target claude --locale pl --dry-run
```

Następnie zainstaluj polską dokumentację w `~/.claude/docs/pl/`:

```bash
node scripts/install-apply.js --target claude --locale pl
```

Ten wybór instaluje moduł dokumentacji `docs-pl`; nie instaluje pełnego profilu ECC
ani automatycznych Hooków.

## Co zawiera ECC

| Powierzchnia | Rola |
|---|---|
| `agents/` | wyspecjalizowane Agenty do planowania, implementacji, przeglądu i diagnostyki |
| `skills/` | modułowe procedury i wiedza aktywowane zależnie od zadania |
| `hooks/` | automatyzacje uruchamiane przy zdarzeniach środowiska |
| `rules/` | stałe zasady wspólne oraz reguły języków i frameworków |
| `commands/` | starsza warstwa zgodności dla poleceń slash |
| `mcp-configs/` | konfiguracje serwerów Model Context Protocol |
| `manifests/` | deklaratywne moduły, komponenty i profile instalatora |

Kierunek projektu jest **skills-first**: nowe przepływy pracy powinny trafiać najpierw do
`skills/`; `commands/` pozostaje powierzchnią zgodności tam, gdzie nadal jest potrzebna.

## Najważniejsze pojęcia

### Agenty

Agent ma określoną rolę, zestaw narzędzi i sposób pracy. Przykłady obejmują planistę,
recenzentów kodu dla konkretnych języków oraz specjalistów od rozwiązywania błędów kompilacji.

### Skille

Skill przechowuje skoncentrowaną procedurę lub wiedzę dziedzinową. Dzięki temu kontekst jest
ładowany tylko wtedy, gdy pasuje do zadania, zamiast powiększać każdy prompt systemowy.

### Hooki

Hook reaguje na zdarzenia takie jak rozpoczęcie sesji lub użycie narzędzia. Hooki muszą być
przenośne i bezpieczne; nie kopiuj ich drugi raz do ustawień po instalacji pluginu, ponieważ
nowe wersje Claude Code ładują `hooks/hooks.json` automatycznie.

### Rules

Rules opisują zawsze obowiązujące konwencje. Instaluj wspólny rdzeń i tylko pasujące pakiety,
aby nie obciążać okna kontekstu nieistotnymi regułami.

Sposób tłumaczenia terminów ECC opisuje [polski glosariusz](GLOSSARY.md).

## Bezpieczeństwo

- Nie zapisuj kluczy API, haseł ani tokenów w repozytorium.
- Przeglądaj skrypty i źródła pakietów przed uruchomieniem.
- Nie łącz wielu metod instalacji.
- Nie kopiuj surowego `hooks/hooks.json` do `~/.claude/settings.json` po instalacji pluginu.
- Używaj minimalnych uprawnień i weryfikuj wejścia na granicach systemu.

Szczegółowe informacje znajdują się w [sekcji Security](../../README.md#security).

## Aktualizowanie tłumaczenia

Tłumaczenia są utrzymywane według zasady „best effort”. Każdy PR powinien podawać:

1. commit angielskiego źródła,
2. dokładny zakres przetłumaczonej treści,
3. zmiany w terminologii względem [GLOSSARY.md](GLOSSARY.md),
4. wykonane sprawdzenia linków, Markdownu i manifestów instalatora.

Kolejne PR-y powinny być małe i podzielone według domen, na przykład `commands/`, `agents/`,
`rules/` i `skills/`. Pozwala to uniknąć nakładających się tłumaczeń i ułatwia synchronizację
z szybko zmieniającym się źródłem angielskim.

## Współtworzenie

Przed rozpoczęciem większego tłumaczenia sprawdź istniejące issues i PR-y, aby uniknąć
równoległej pracy nad tym samym zakresem. Zasady tworzenia zmian i opisów PR znajdują się w
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licencja

MIT — możesz swobodnie używać i dostosowywać projekt oraz dzielić się ulepszeniami.

---

**Jeśli ECC Ci pomaga, zostaw gwiazdkę. Przeczytaj przewodniki. Zbuduj coś świetnego.**
