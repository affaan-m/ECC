**Язык:** [English](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | **Русский** | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md)

# Everything Claude Code

![Everything Claude Code — система повышения эффективности сред агентного ИИ](../../assets/hero.png)

[![Stars](https://img.shields.io/github/stars/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/stargazers)
[![Forks](https://img.shields.io/github/forks/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/network/members)
[![Contributors](https://img.shields.io/github/contributors/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/graphs/contributors)
[![npm ecc-universal](https://img.shields.io/npm/dw/ecc-universal?label=ecc-universal%20weekly%20downloads&logo=npm)](https://www.npmjs.com/package/ecc-universal)
[![npm ecc-agentshield](https://img.shields.io/npm/dw/ecc-agentshield?label=ecc-agentshield%20weekly%20downloads&logo=npm)](https://www.npmjs.com/package/ecc-agentshield)
[![GitHub App Install](https://img.shields.io/badge/GitHub%20App-150%20installs-2ea44f?logo=github)](https://github.com/marketplace/ecc-tools)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
![Shell](https://img.shields.io/badge/-Shell-4EAA25?logo=gnu-bash&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)
![Go](https://img.shields.io/badge/-Go-00ADD8?logo=go&logoColor=white)
![Java](https://img.shields.io/badge/-Java-ED8B00?logo=openjdk&logoColor=white)
![Perl](https://img.shields.io/badge/-Perl-39457E?logo=perl&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown&logoColor=white)

> **140K+ звёзд** | **21K+ форков** | **170+ участников** | **12+ языковых экосистем** | **победитель хакатона Anthropic**

---

<div align="center">

**Язык / 语言 / 語言 / Dil / Ngôn ngữ**

[**English**](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | **Русский** | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md)

</div>

---

**Система повышения эффективности для сред агентного ИИ. От победителя хакатона Anthropic.**

Не просто конфиги. Это полноценная система: навыки, инстинкты, оптимизация памяти, непрерывное обучение, сканирование безопасности и разработка с приоритетом исследований. Готовые к рабочему использованию агенты, навыки, хуки, правила, конфигурации MCP и устаревшие совместимые заглушки команд, отточенные за 10+ месяцев интенсивного ежедневного использования при создании реальных продуктов.

Работает в **Claude Code**, **Codex**, **Cursor**, **OpenCode**, **Gemini** и других средах агентного ИИ.

ECC v2.0.0-rc.1 добавляет публичную историю оператора Hermes поверх этого переиспользуемого слоя: начните с [руководства по настройке Hermes](../HERMES-SETUP.md), затем прочитайте [примечания к выпуску rc.1](../releases/2.0.0-rc.1/release-notes.md) и [архитектуру для разных сред](../architecture/cross-harness.md).

---

## Руководства

В этом репозитории находится только исходный код. Руководства объясняют всё остальное.

<table>
<tr>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2012378465664745795">
<img src="../../assets/images/guides/shorthand-guide.png" alt="Краткое руководство по Everything Claude Code" />
</a>
</td>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2014040193557471352">
<img src="../../assets/images/guides/longform-guide.png" alt="Подробное руководство по Everything Claude Code" />
</a>
</td>
<td width="33%">
<a href="https://x.com/affaanmustafa/status/2033263813387223421">
<img src="../../assets/images/security/security-guide-header.png" alt="Краткое руководство по безопасности агентных систем" />
</a>
</td>
</tr>
<tr>
<td align="center"><b>Краткое руководство</b><br/>Установка, основы, философия. <b>Сначала прочитайте его.</b></td>
<td align="center"><b>Подробное руководство</b><br/>Оптимизация токенов, сохранение памяти, evals/оценки, параллелизация.</td>
<td align="center"><b>Руководство по безопасности</b><br/>Векторы атак, песочницы, санитизация, CVE, AgentShield.</td>
</tr>
</table>

| Тема | Что вы узнаете |
|------|----------------|
| Оптимизация токенов | Выбор модели, сокращение системного промпта, фоновые процессы |
| Сохранение памяти | Хуки, которые автоматически сохраняют и загружают контекст между сессиями |
| Непрерывное обучение | Автоматическое извлечение паттернов из сессий в переиспользуемые навыки |
| Циклы верификации | Checkpoint и непрерывные evals, типы оценщиков, метрики pass@k |
| Параллелизация | Git worktrees, каскадный метод, когда масштабировать экземпляры |
| Оркестрация субагентов | Проблема контекста, паттерн итеративного извлечения |

---

## Что нового

### v2.0.0-rc.1 — Обновление публичного контура, операторские рабочие процессы и ECC 2.0 Alpha (апрель 2026)

- **Dashboard GUI** — новое настольное приложение на Tkinter (`ecc_dashboard.py` или `npm run dashboard`) с переключателем тёмной/светлой темы, настройкой шрифта и логотипом проекта в заголовке и панели задач.
- **Публичный контур синхронизирован с текущим репозиторием** — метаданные, счётчики каталога, манифесты плагинов и документация для установки теперь соответствуют реальному OSS-набору: 50 агентов, 185 навыков и 68 устаревших совместимых заглушек команд.
- **Расширение операторских и outbound-рабочих процессов** — `brand-voice`, `social-graph-ranker`, `connections-optimizer`, `customer-billing-ops`, `ecc-tools-cost-audit`, `google-workspace-ops`, `project-flow-ops` и `workspace-surface-audit` закрывают операторское направление.
- **Медиа и инструменты запуска** — `manim-video`, `remotion-video-creation` и обновлённые интерфейсы публикации в соцсетях делают технические объяснения и launch-контент частью той же системы.
- **Рост поддержки фреймворков и продуктов** — `nestjs-patterns`, более развитые пути установки для Codex/OpenCode и расширенная упаковка для разных сред сохраняют полезность репозитория не только для Claude Code.
- **ECC 2.0 alpha находится в дереве репозитория** — прототип control plane на Rust в `ecc2/` теперь собирается локально и предоставляет команды `dashboard`, `start`, `sessions`, `status`, `stop`, `resume` и `daemon`. Это пригодная к использованию alpha-версия, но ещё не общий релиз.
- **Укрепление экосистемы** — AgentShield, контроль затрат ECC Tools, работа над billing portal и обновления сайта продолжают поставляться вокруг основного плагина, а не расползаются по отдельным направлениям.

### v1.9.0 — Выборочная установка и расширение языковой поддержки (март 2026)

- **Архитектура выборочной установки** — установка на основе манифестов через `install-plan.js` и `install-apply.js` для точечной установки компонентов. Хранилище состояния отслеживает установленные компоненты и поддерживает инкрементальные обновления.
- **6 новых агентов** — `typescript-reviewer`, `pytorch-build-resolver`, `java-build-resolver`, `java-reviewer`, `kotlin-reviewer`, `kotlin-build-resolver` расширяют языковое покрытие до 10 языков.
- **Новые навыки** — `pytorch-patterns` для рабочих процессов глубокого обучения, `documentation-lookup` для исследования API-справочников, `bun-runtime` и `nextjs-turbopack` для современных JS-инструментов, а также 8 операционных предметных навыков и `mcp-server-patterns`.
- **Инфраструктура сессий и состояния** — SQLite-хранилище состояния с CLI для запросов, адаптеры сессий для структурированной записи, фундамент эволюции навыков для самоулучшающихся skills.
- **Переработка оркестрации** — оценка аудита среды стала детерминированной, статус оркестрации и совместимость launcher укреплены, предотвращение observer loops реализовано 5-уровневой защитой.
- **Надёжность observer** — исправление взрывного роста памяти через throttling и tail sampling, исправление доступа к песочнице, lazy-start логика и защита от повторного входа.
- **12 языковых экосистем** — новые правила для Java, PHP, Perl, Kotlin/Android/KMP, C++ и Rust добавлены к существующим правилам TypeScript, Python, Go и общим правилам.
- **Вклад сообщества** — переводы на корейский и китайский, оптимизация biome hook, навыки обработки видео, операционные навыки, PowerShell-установщик, поддержка Antigravity IDE.
- **Укрепление CI** — исправлены 19 падений тестов, добавлена принудительная проверка счётчиков каталога, валидация установочного манифеста, полный набор тестов проходит.

### v1.8.0 — Система повышения эффективности сред агентного ИИ (март 2026)

- **Релиз с фокусом на средах агентного ИИ** — ECC теперь явно позиционируется как система повышения эффективности таких сред, а не просто набор конфигов.
- **Переработка надёжности хуков** — fallback корня для SessionStart, сводки сессий в фазе Stop и скриптовые хуки вместо хрупких inline-однострочников.
- **Управление хуками во время выполнения** — `ECC_HOOK_PROFILE=minimal|standard|strict` и `ECC_DISABLED_HOOKS=...` для runtime-ограничений без редактирования файлов хуков.
- **Новые команды для сред** — `/harness-audit`, `/loop-start`, `/loop-status`, `/quality-gate`, `/model-route`.
- **NanoClaw v2** — маршрутизация моделей, горячая загрузка навыков, ветвление/поиск/экспорт/компактификация/метрики сессий.
- **Паритет между средами** — поведение ужесточено для Claude Code, Cursor, OpenCode и Codex app/CLI.
- **997 внутренних тестов проходят** — весь набор зелёный после рефакторинга hooks/runtime и обновлений совместимости.

### v1.7.0 — Расширение на другие платформы и конструктор презентаций (февраль 2026)

- **Поддержка Codex app + CLI** — прямая поддержка Codex через `AGENTS.md`, выбор цели установщика и документация по Codex
- **Навык `frontend-slides`** — HTML-конструктор презентаций без зависимостей, с рекомендациями по конвертации PPTX и строгими правилами подгонки под viewport
- **5 новых общих бизнес- и контент-навыков** — `article-writing`, `content-engine`, `market-research`, `investor-materials`, `investor-outreach`
- **Более широкое покрытие инструментов** — поддержка Cursor, Codex и OpenCode усилена так, чтобы один репозиторий аккуратно поставлялся во все основные среды
- **992 внутренних теста** — расширенная валидация и регрессионное покрытие для плагина, хуков, навыков и упаковки

### v1.6.0 — Codex CLI, AgentShield и Marketplace (февраль 2026)

- **Поддержка Codex CLI** — новая команда `/codex-setup` генерирует `codex.md` для совместимости с OpenAI Codex CLI
- **7 новых навыков** — `search-first`, `swift-actor-persistence`, `swift-protocol-di-testing`, `regex-vs-llm-structured-text`, `content-hash-cache-pattern`, `cost-aware-llm-pipeline`, `skill-stocktake`
- **Интеграция AgentShield** — навык `/security-scan` запускает AgentShield прямо из Claude Code; 1282 теста, 102 правила
- **GitHub Marketplace** — GitHub App ECC Tools доступен на [github.com/marketplace/ecc-tools](https://github.com/marketplace/ecc-tools) с тарифами free/pro/enterprise
- **Объединено 30+ PR сообщества** — вклад 30 участников на 6 языках
- **978 внутренних тестов** — расширенный набор валидации для агентов, навыков, команд, хуков и правил

### v1.4.1 — Исправление ошибки (февраль 2026)

- **Исправлена потеря содержимого при импорте инстинктов** — `parse_instinct_file()` незаметно отбрасывал всё содержимое после frontmatter (разделы Action, Evidence, Examples) во время `/instinct-import`. ([#148](https://github.com/affaan-m/everything-claude-code/issues/148), [#161](https://github.com/affaan-m/everything-claude-code/pull/161))

### v1.4.0 — Многоязычные правила, мастер установки и PM2 (февраль 2026)

- **Интерактивный мастер установки** — новый навык `configure-ecc` предоставляет пошаговую настройку с обнаружением merge/overwrite
- **PM2 и многоагентная оркестрация** — 6 новых команд (`/pm2`, `/multi-plan`, `/multi-execute`, `/multi-backend`, `/multi-frontend`, `/multi-workflow`) для управления сложными многоcервисными рабочими процессами
- **Архитектура многоязычных правил** — правила реструктурированы из плоских файлов в директории `common/` + `typescript/` + `python/` + `golang/`. Устанавливайте только нужные языки
- **Переводы на китайский (zh-CN)** — полный перевод всех агентов, команд, навыков и правил (80+ файлов)
- **Поддержка GitHub Sponsors** — поддержите проект через GitHub Sponsors
- **Улучшенный CONTRIBUTING.md** — подробные шаблоны PR для каждого типа вклада

### v1.3.0 — Поддержка плагина OpenCode (февраль 2026)

- **Полная интеграция OpenCode** — 12 агентов, 24 команды, 16 навыков с поддержкой хуков через систему плагинов OpenCode (20+ типов событий)
- **3 нативных custom tools** — run-tests, check-coverage, security-audit
- **LLM-документация** — `llms.txt` с полной документацией OpenCode

### v1.2.0 — Унифицированные команды и навыки (февраль 2026)

- **Поддержка Python/Django** — паттерны Django, безопасность, TDD и навыки верификации
- **Навыки Java Spring Boot** — паттерны, безопасность, TDD и верификация для Spring Boot
- **Управление сессиями** — команда `/sessions` для истории сессий
- **Непрерывное обучение v2** — обучение на основе инстинктов с оценкой уверенности, импортом/экспортом и эволюцией

Полный журнал изменений смотрите в [Releases](https://github.com/affaan-m/everything-claude-code/releases).

---

## Быстрый старт

Запустите всё менее чем за 2 минуты:

### Выберите только один путь

Большинству пользователей Claude Code нужен ровно один путь установки:

- **Рекомендуемый вариант по умолчанию:** установите плагин Claude Code, затем скопируйте только те папки правил, которые вам действительно нужны.
- **Используйте ручной установщик только если** вам нужен более тонкий контроль, вы хотите полностью избежать пути через плагин или ваша сборка Claude Code не может разрешить self-hosted запись в marketplace.
- **Не накладывайте методы установки друг на друга.** Самая частая сломанная конфигурация: сначала `/plugin install`, затем `install.sh --profile full` или `npx ecc-install --profile full`.

Если вы уже наложили несколько установок и видите дублирование, сразу переходите к разделу [Сброс / удаление ECC](#сброс--удаление-ecc).

### Путь с малым контекстом / без хуков

Если хуки кажутся слишком глобальными или вам нужны только правила, агенты, команды и основные навыки рабочих процессов ECC, пропустите плагин и используйте минимальный ручной профиль:

```bash
./install.sh --profile minimal --target claude
```

```powershell
.\install.ps1 --profile minimal --target claude
# или
npx ecc-install --profile minimal --target claude
```

Этот профиль намеренно исключает `hooks-runtime`.

Если вам нужен обычный core-профиль, но без хуков, используйте:

```bash
./install.sh --profile core --without baseline:hooks --target claude
```

Добавляйте хуки позже только если вам нужно runtime-принуждение:

```bash
./install.sh --target claude --modules hooks-runtime
```

### Сначала найдите нужные компоненты

Если вы не уверены, какой профиль ECC или компонент установить, спросите упакованный advisor из любого проекта:

```bash
npx ecc consult "security reviews" --target claude
```

Он вернёт подходящие компоненты, связанные профили и команды предпросмотра/установки. Используйте команду предпросмотра перед установкой, если хотите посмотреть точный план файлов.

### Шаг 1: Установите плагин (рекомендуется)

> ПРИМЕЧАНИЕ: Плагин удобен, но OSS-установщик ниже всё ещё остаётся самым надёжным путём, если ваша сборка Claude Code не может разрешить self-hosted записи marketplace.

```bash
# Добавьте marketplace
/plugin marketplace add https://github.com/affaan-m/everything-claude-code

# Установите плагин
/plugin install ecc@ecc
```

### Примечание об именовании и миграции

У ECC теперь три публичных идентификатора, и они не взаимозаменяемы:

- исходный репозиторий GitHub: `affaan-m/everything-claude-code`
- идентификатор Claude marketplace/plugin: `ecc@ecc`
- npm-пакет: `ecc-universal`

Это сделано намеренно. Установки Anthropic marketplace/plugin ключуются каноническим идентификатором плагина, поэтому ECC использует `ecc@ecc`, чтобы имена инструментов и пространства имен slash-команд оставались достаточно короткими для строгих валидаторов Desktop/API. Старые публикации могут всё ещё показывать прежний длинный marketplace-идентификатор; считайте его только устаревшим alias. Отдельно npm-пакет остался `ecc-universal`, поэтому npm-установки и marketplace-установки намеренно используют разные имена.

### Шаг 2: Установите правила (обязательно)

> ПРЕДУПРЕЖДЕНИЕ: **Важно:** плагины Claude Code не могут автоматически распространять `rules`.
>
> Если вы уже установили ECC через `/plugin install`, **не запускайте после этого `./install.sh --profile full`, `.\install.ps1 --profile full` или `npx ecc-install --profile full`**. Плагин уже загружает навыки, команды и хуки ECC. Запуск полного установщика после установки плагина скопирует те же компоненты в пользовательские директории и может создать дублирующиеся навыки и дублирующееся runtime-поведение.
>
> Для установки через плагин вручную скопируйте только нужные директории `rules/` в `~/.claude/rules/ecc/`. Начните с `rules/common` плюс один языковой или framework-пакет, который вы действительно используете. Не копируйте все директории правил, если явно не хотите весь этот контекст в Claude.
>
> Используйте полный установщик только если делаете полностью ручную установку ECC вместо пути через плагин.
>
> Если ваша локальная установка Claude была очищена или сброшена, это не значит, что нужно повторно покупать ECC. Начните с `node scripts/ecc.js list-installed`, затем запустите `node scripts/ecc.js doctor` и `node scripts/ecc.js repair` перед любой переустановкой. Обычно это восстанавливает файлы, управляемые ECC, без пересборки всей настройки. Если проблема связана с аккаунтом или marketplace-доступом к ECC Tools, восстановление billing/account нужно делать отдельно.

```bash
# Сначала клонируйте репозиторий
git clone https://github.com/affaan-m/everything-claude-code.git
cd everything-claude-code

# Установите зависимости (выберите пакетный менеджер)
npm install        # или: pnpm install | yarn install | bun install

# Путь установки через плагин: скопируйте только правила ECC в пространство имён ECC
mkdir -p ~/.claude/rules/ecc
cp -R rules/common ~/.claude/rules/ecc/
cp -R rules/typescript ~/.claude/rules/ecc/

# Полностью ручной путь установки ECC (используйте вместо /plugin install)
# ./install.sh --profile full
```

```powershell
# Windows PowerShell

# Путь установки через плагин: скопируйте только правила ECC в пространство имён ECC
New-Item -ItemType Directory -Force -Path "$HOME/.claude/rules/ecc" | Out-Null
Copy-Item -Recurse rules/common "$HOME/.claude/rules/ecc/"
Copy-Item -Recurse rules/typescript "$HOME/.claude/rules/ecc/"

# Полностью ручной путь установки ECC (используйте вместо /plugin install)
# .\install.ps1 --profile full
# npx ecc-install --profile full
```

Инструкции по ручной установке смотрите в README в папке `rules/`. При ручном копировании правил копируйте всю языковую директорию целиком (например, `rules/common` или `rules/golang`), а не файлы внутри неё, чтобы относительные ссылки продолжали работать и имена файлов не конфликтовали.

### Полностью ручная установка (fallback)

Используйте это только если вы намеренно пропускаете путь через плагин:

```bash
./install.sh --profile full
```

```powershell
.\install.ps1 --profile full
# или
npx ecc-install --profile full
```

Если выбираете этот путь, на нём и остановитесь. Не запускайте дополнительно `/plugin install`.

### Сброс / удаление ECC

Если ECC кажется дублированным, навязчивым или сломанным, не переустанавливайте его снова поверх самого себя.

- **Путь через плагин:** удалите плагин из Claude Code, затем удалите конкретные папки правил, которые вы вручную скопировали в `~/.claude/rules/ecc/`.
- **Ручной установщик / CLI-путь:** из корня репозитория сначала посмотрите preview удаления:

```bash
node scripts/uninstall.js --dry-run
```

Затем удалите файлы, управляемые ECC:

```bash
node scripts/uninstall.js
```

Также можно использовать lifecycle-wrapper:

```bash
node scripts/ecc.js list-installed
node scripts/ecc.js doctor
node scripts/ecc.js repair
node scripts/ecc.js uninstall --dry-run
```

ECC удаляет только файлы, записанные в его install-state. Он не удалит посторонние файлы, которые сам не устанавливал.

Если вы смешали методы, очищайте в таком порядке:

1. Удалите установку плагина Claude Code.
2. Запустите команду удаления ECC из корня репозитория, чтобы удалить файлы, управляемые install-state.
3. Удалите любые дополнительные папки правил, которые вы скопировали вручную и больше не хотите использовать.
4. Переустановите один раз, используя один путь.

### Шаг 3: Начните использовать

```bash
# Навыки — основной рабочий интерфейс.
# Существующие slash-style имена команд продолжают работать, пока ECC мигрирует с commands/.

# Установка через плагин использует каноническую форму с namespace
/ecc:plan "Добавить аутентификацию пользователей"

# Ручная установка сохраняет более короткую slash-форму:
# /plan "Добавить аутентификацию пользователей"

# Проверить доступные команды
/plugin list ecc@ecc
```

**Готово.** Теперь у вас есть доступ к 50 агентам, 185 навыкам и 68 устаревшим совместимым заглушкам команд.

### Dashboard GUI

Запустите настольную панель управления, чтобы визуально изучить компоненты ECC:

```bash
npm run dashboard
# или
python3 ./ecc_dashboard.py
```

**Возможности:**
- интерфейс с вкладками: Agents, Skills, Commands, Rules, Settings
- переключение тёмной/светлой темы
- настройка шрифта (семейство и размер)
- логотип проекта в заголовке и панели задач
- поиск и фильтрация по всем компонентам

### Мультимодельные команды требуют дополнительной настройки

> ПРЕДУПРЕЖДЕНИЕ: команды `multi-*` **не** покрываются базовой установкой плагина/правил выше.
>
> Чтобы использовать `/multi-plan`, `/multi-execute`, `/multi-backend`, `/multi-frontend` и `/multi-workflow`, нужно также установить runtime `ccg-workflow`.
>
> Инициализируйте его через `npx ccg-workflow`.
>
> Этот runtime предоставляет внешние зависимости, которых ожидают эти команды, включая:
> - `~/.claude/bin/codeagent-wrapper`
> - `~/.claude/.ccg/prompts/*`
>
> Без `ccg-workflow` эти `multi-*` команды не будут работать корректно.

---

## Кроссплатформенная поддержка

Плагин теперь полностью поддерживает **Windows, macOS и Linux**, а также плотно интегрирован с основными IDE (Cursor, OpenCode, Antigravity) и CLI-средами. Все хуки и скрипты переписаны на Node.js для максимальной совместимости.

### Определение пакетного менеджера

Плагин автоматически определяет предпочитаемый пакетный менеджер (npm, pnpm, yarn или bun) в таком порядке приоритета:

1. **Переменная окружения**: `CLAUDE_PACKAGE_MANAGER`
2. **Конфиг проекта**: `.claude/package-manager.json`
3. **package.json**: поле `packageManager`
4. **Lock-файл**: определение по package-lock.json, yarn.lock, pnpm-lock.yaml или bun.lockb
5. **Глобальный конфиг**: `~/.claude/package-manager.json`
6. **Fallback**: первый доступный пакетный менеджер

Чтобы задать предпочитаемый пакетный менеджер:

```bash
# Через переменную окружения
export CLAUDE_PACKAGE_MANAGER=pnpm

# Через глобальный конфиг
node scripts/setup-package-manager.js --global pnpm

# Через конфиг проекта
node scripts/setup-package-manager.js --project bun

# Определить текущую настройку
node scripts/setup-package-manager.js --detect
```

Или используйте команду `/setup-pm` в Claude Code.

### Управление хуками во время выполнения

Используйте флаги времени выполнения, чтобы настроить строгость или временно отключить отдельные хуки:

```bash
# Профиль строгости хуков (по умолчанию: standard)
export ECC_HOOK_PROFILE=standard

# ID хуков для отключения, перечисленные через запятую
export ECC_DISABLED_HOOKS="pre:bash:tmux-reminder,post:edit:typecheck"

# Ограничить дополнительный контекст SessionStart (по умолчанию: 8000 символов)
export ECC_SESSION_START_MAX_CHARS=4000

# Полностью отключить дополнительный контекст SessionStart для local-model/low-context настроек
export ECC_SESSION_START_CONTEXT=off
```

---

## Что внутри

Этот репозиторий — **плагин Claude Code**: установите его напрямую или скопируйте компоненты вручную.

```
everything-claude-code/
|-- .claude-plugin/   # Манифесты плагина и marketplace
|   |-- plugin.json         # Метаданные плагина и пути компонентов
|   |-- marketplace.json    # Каталог marketplace для /plugin marketplace add
|
|-- agents/           # 50 специализированных субагентов для делегирования
|   |-- planner.md           # Планирование реализации функций
|   |-- architect.md         # Решения по системному дизайну
|   |-- tdd-guide.md         # Разработка через тестирование
|   |-- code-reviewer.md     # Проверка качества и безопасности
|   |-- security-reviewer.md # Анализ уязвимостей
|   |-- build-error-resolver.md
|   |-- e2e-runner.md        # E2E-тестирование Playwright
|   |-- refactor-cleaner.md  # Очистка мёртвого кода
|   |-- doc-updater.md       # Синхронизация документации
|   |-- docs-lookup.md       # Поиск документации/API
|   |-- chief-of-staff.md    # Триаж коммуникаций и черновики
|   |-- loop-operator.md     # Выполнение автономных циклов
|   |-- harness-optimizer.md # Тюнинг конфигурации среды агентного ИИ
|   |-- cpp-reviewer.md      # Ревью C++ кода
|   |-- cpp-build-resolver.md # Исправление ошибок сборки C++
|   |-- go-reviewer.md       # Ревью Go-кода
|   |-- go-build-resolver.md # Исправление ошибок сборки Go
|   |-- python-reviewer.md   # Ревью Python-кода
|   |-- database-reviewer.md # Ревью Database/Supabase
|   |-- typescript-reviewer.md # Ревью TypeScript/JavaScript кода
|   |-- java-reviewer.md     # Ревью Java/Spring Boot кода
|   |-- java-build-resolver.md # Ошибки Java/Maven/Gradle сборки
|   |-- kotlin-reviewer.md   # Ревью Kotlin/Android/KMP кода
|   |-- kotlin-build-resolver.md # Ошибки Kotlin/Gradle сборки
|   |-- rust-reviewer.md     # Ревью Rust-кода
|   |-- rust-build-resolver.md # Исправление ошибок сборки Rust
|   |-- pytorch-build-resolver.md # Ошибки PyTorch/CUDA/training
|
|-- skills/           # Определения рабочих процессов и предметные знания
|   |-- coding-standards/           # Лучшие практики языков
|   |-- clickhouse-io/              # ClickHouse analytics, queries, data engineering
|   |-- backend-patterns/           # Паттерны API, БД, кеширования
|   |-- frontend-patterns/          # Паттерны React, Next.js
|   |-- frontend-slides/            # HTML-слайды и PPTX-to-web workflow презентаций (НОВОЕ)
|   |-- article-writing/            # Длинные тексты в заданном голосе без generic AI tone (НОВОЕ)
|   |-- content-engine/             # Мультиплатформенный social content и переупаковка материалов (НОВОЕ)
|   |-- market-research/            # Market/competitor/investor research с атрибуцией источников (НОВОЕ)
|   |-- investor-materials/         # Pitch decks, one-pagers, memos и финансовые модели (НОВОЕ)
|   |-- investor-outreach/          # Персонализированный fundraising outreach и follow-up (НОВОЕ)
|   |-- continuous-learning/        # Legacy v1 Stop-hook extraction паттернов
|   |-- continuous-learning-v2/     # Обучение на основе инстинктов с confidence scoring
|   |-- iterative-retrieval/        # Прогрессивное уточнение контекста для субагентов
|   |-- strategic-compact/          # Рекомендации по ручной компактификации (Longform Guide)
|   |-- tdd-workflow/               # Методология TDD
|   |-- security-review/            # Чеклист безопасности
|   |-- eval-harness/               # Оценка verification loop (Longform Guide)
|   |-- verification-loop/          # Непрерывная верификация (Longform Guide)
|   |-- videodb/                   # Видео и аудио: ingest, search, edit, generate, stream (НОВОЕ)
|   |-- golang-patterns/            # Go idioms и лучшие практики
|   |-- golang-testing/             # Паттерны тестирования Go, TDD, benchmarks
|   |-- cpp-coding-standards/         # C++ coding standards из C++ Core Guidelines (НОВОЕ)
|   |-- cpp-testing/                # C++ тестирование с GoogleTest, CMake/CTest (НОВОЕ)
|   |-- django-patterns/            # Django patterns, models, views (НОВОЕ)
|   |-- django-security/            # Лучшие практики безопасности Django (НОВОЕ)
|   |-- django-tdd/                 # Django TDD workflow (НОВОЕ)
|   |-- django-verification/        # Django verification loops (НОВОЕ)
|   |-- laravel-patterns/           # Архитектурные паттерны Laravel (НОВОЕ)
|   |-- laravel-security/           # Лучшие практики безопасности Laravel (НОВОЕ)
|   |-- laravel-tdd/                # Laravel TDD workflow (НОВОЕ)
|   |-- laravel-verification/       # Laravel verification loops (НОВОЕ)
|   |-- python-patterns/            # Python idioms и лучшие практики (НОВОЕ)
|   |-- python-testing/             # Тестирование Python с pytest (НОВОЕ)
|   |-- springboot-patterns/        # Паттерны Java Spring Boot (НОВОЕ)
|   |-- springboot-security/        # Безопасность Spring Boot (НОВОЕ)
|   |-- springboot-tdd/             # Spring Boot TDD (НОВОЕ)
|   |-- springboot-verification/    # Spring Boot verification (НОВОЕ)
|   |-- configure-ecc/              # Интерактивный мастер установки (НОВОЕ)
|   |-- security-scan/              # Интеграция аудитора безопасности AgentShield (НОВОЕ)
|   |-- java-coding-standards/     # Стандарты кодирования Java (НОВОЕ)
|   |-- jpa-patterns/              # Паттерны JPA/Hibernate (НОВОЕ)
|   |-- postgres-patterns/         # Паттерны оптимизации PostgreSQL (НОВОЕ)
|   |-- nutrient-document-processing/ # Обработка документов через Nutrient API (НОВОЕ)
|   |-- docs/examples/project-guidelines-template.md  # Шаблон проектных skills
|   |-- database-migrations/         # Паттерны миграций (Prisma, Drizzle, Django, Go) (НОВОЕ)
|   |-- api-design/                  # REST API design, pagination, error responses (НОВОЕ)
|   |-- deployment-patterns/         # CI/CD, Docker, health checks, rollbacks (НОВОЕ)
|   |-- docker-patterns/            # Docker Compose, networking, volumes, container security (НОВОЕ)
|   |-- e2e-testing/                 # Playwright E2E patterns и Page Object Model (НОВОЕ)
|   |-- content-hash-cache-pattern/  # Кеширование по SHA-256 content hash для обработки файлов (НОВОЕ)
|   |-- cost-aware-llm-pipeline/     # Оптимизация LLM-затрат, model routing, budget tracking (НОВОЕ)
|   |-- regex-vs-llm-structured-text/ # Decision framework: regex vs LLM для разбора текста (НОВОЕ)
|   |-- swift-actor-persistence/     # Thread-safe Swift data persistence через actors (НОВОЕ)
|   |-- swift-protocol-di-testing/   # Protocol-based DI для тестируемого Swift-кода (НОВОЕ)
|   |-- search-first/               # Workflow research-before-coding (НОВОЕ)
|   |-- skill-stocktake/            # Аудит навыков и команд на качество (НОВОЕ)
|   |-- liquid-glass-design/         # iOS 26 Liquid Glass design system (НОВОЕ)
|   |-- foundation-models-on-device/ # Apple on-device LLM с FoundationModels (НОВОЕ)
|   |-- swift-concurrency-6-2/       # Swift 6.2 Approachable Concurrency (НОВОЕ)
|   |-- perl-patterns/             # Современные Perl 5.36+ idioms и лучшие практики (НОВОЕ)
|   |-- perl-security/             # Perl security patterns, taint mode, safe I/O (НОВОЕ)
|   |-- perl-testing/              # Perl TDD с Test2::V0, prove, Devel::Cover (НОВОЕ)
|   |-- autonomous-loops/           # Паттерны автономных циклов: sequential pipelines, PR loops, DAG orchestration (НОВОЕ)
|   |-- plankton-code-quality/      # Write-time code quality enforcement через Plankton hooks (НОВОЕ)
|
|-- commands/         # Поддерживаемая совместимость slash entries; предпочитайте skills/
|   |-- plan.md             # /plan - Планирование реализации
|   |-- code-review.md      # /code-review - Ревью качества
|   |-- build-fix.md        # /build-fix - Исправление ошибок сборки
|   |-- refactor-clean.md   # /refactor-clean - Удаление мёртвого кода
|   |-- quality-gate.md     # /quality-gate - Verification gate
|   |-- learn.md            # /learn - Извлечение паттернов в середине сессии (Longform Guide)
|   |-- learn-eval.md       # /learn-eval - Извлечь, оценить и сохранить паттерны (НОВОЕ)
|   |-- checkpoint.md       # /checkpoint - Сохранить состояние верификации (Longform Guide)
|   |-- setup-pm.md         # /setup-pm - Настроить пакетный менеджер
|   |-- go-review.md        # /go-review - Ревью Go-кода (НОВОЕ)
|   |-- go-test.md          # /go-test - Go TDD workflow (НОВОЕ)
|   |-- go-build.md         # /go-build - Исправить ошибки сборки Go (НОВОЕ)
|   |-- skill-create.md     # /skill-create - Генерировать skills из истории Git (НОВОЕ)
|   |-- instinct-status.md  # /instinct-status - Посмотреть изученные инстинкты (НОВОЕ)
|   |-- instinct-import.md  # /instinct-import - Импортировать инстинкты (НОВОЕ)
|   |-- instinct-export.md  # /instinct-export - Экспортировать инстинкты (НОВОЕ)
|   |-- evolve.md           # /evolve - Кластеризовать инстинкты в skills
|   |-- prune.md            # /prune - Удалить истёкшие pending-инстинкты (НОВОЕ)
|   |-- pm2.md              # /pm2 - Управление lifecycle сервисов PM2 (НОВОЕ)
|   |-- multi-plan.md       # /multi-plan - Многоагентная декомпозиция задач (НОВОЕ)
|   |-- multi-execute.md    # /multi-execute - Оркестрированные многоагентные workflow (НОВОЕ)
|   |-- multi-backend.md    # /multi-backend - Backend multi-service orchestration (НОВОЕ)
|   |-- multi-frontend.md   # /multi-frontend - Frontend multi-service orchestration (НОВОЕ)
|   |-- multi-workflow.md   # /multi-workflow - General multi-service workflows (НОВОЕ)
|   |-- sessions.md         # /sessions - Управление историей сессий
|   |-- test-coverage.md    # /test-coverage - Анализ покрытия тестами
|   |-- update-docs.md      # /update-docs - Обновление документации
|   |-- update-codemaps.md  # /update-codemaps - Обновление codemaps
|   |-- python-review.md    # /python-review - Ревью Python-кода (НОВОЕ)
|-- legacy-command-shims/   # Opt-in архив retired shims вроде /tdd и /eval
|   |-- tdd.md              # /tdd - Предпочитайте skill tdd-workflow
|   |-- e2e.md              # /e2e - Предпочитайте skill e2e-testing
|   |-- eval.md             # /eval - Предпочитайте skill eval-harness
|   |-- verify.md           # /verify - Предпочитайте skill verification-loop
|   |-- orchestrate.md      # /orchestrate - Предпочитайте dmux-workflows или multi-workflow
|
|-- rules/            # Always-follow guidelines (копируйте в ~/.claude/rules/ecc/)
|   |-- README.md            # Обзор структуры и руководство по установке
|   |-- common/              # Языконезависимые принципы
|   |   |-- coding-style.md    # Иммутабельность, организация файлов
|   |   |-- git-workflow.md    # Формат коммитов, PR-процесс
|   |   |-- testing.md         # TDD, требование 80% покрытия
|   |   |-- performance.md     # Выбор моделей, управление контекстом
|   |   |-- patterns.md        # Design patterns, skeleton projects
|   |   |-- hooks.md           # Архитектура хуков, TodoWrite
|   |   |-- agents.md          # Когда делегировать субагентам
|   |   |-- security.md        # Обязательные проверки безопасности
|   |-- typescript/          # Специфика TypeScript/JavaScript
|   |-- python/              # Специфика Python
|   |-- golang/              # Специфика Go
|   |-- swift/               # Специфика Swift
|   |-- php/                 # Специфика PHP (НОВОЕ)
|
|-- hooks/            # Автоматизации на основе триггеров
|   |-- README.md                 # Документация хуков, рецепты и руководство по кастомизации
|   |-- hooks.json                # Конфиг всех хуков (PreToolUse, PostToolUse, Stop и т.д.)
|   |-- memory-persistence/       # Хуки lifecycle сессии (Longform Guide)
|   |-- strategic-compact/        # Предложения компактификации (Longform Guide)
|
|-- scripts/          # Кроссплатформенные Node.js скрипты (НОВОЕ)
|   |-- lib/                     # Общие утилиты
|   |   |-- utils.js             # Кроссплатформенные утилиты для файлов, путей и системы
|   |   |-- package-manager.js   # Определение и выбор пакетного менеджера
|   |-- hooks/                   # Реализации хуков
|   |   |-- session-start.js     # Загрузить контекст при старте сессии
|   |   |-- session-end.js       # Сохранить состояние при завершении сессии
|   |   |-- pre-compact.js       # Сохранение состояния перед compaction
|   |   |-- suggest-compact.js   # Предложения стратегической compaction
|   |   |-- evaluate-session.js  # Извлечение паттернов из сессий
|   |-- setup-package-manager.js # Интерактивная настройка PM
|
|-- tests/            # Набор тестов (НОВОЕ)
|   |-- lib/                     # Тесты библиотек
|   |-- hooks/                   # Тесты хуков
|   |-- run-all.js               # Запустить все тесты
|
|-- contexts/         # Контексты динамической инъекции системного промпта (Longform Guide)
|   |-- dev.md              # Контекст режима разработки
|   |-- review.md           # Контекст режима code review
|   |-- research.md         # Контекст режима research/exploration
|
|-- examples/         # Примеры конфигураций и сессий
|   |-- CLAUDE.md             # Пример project-level конфига
|   |-- user-CLAUDE.md        # Пример user-level конфига
|   |-- saas-nextjs-CLAUDE.md   # Реальный SaaS (Next.js + Supabase + Stripe)
|   |-- go-microservice-CLAUDE.md # Реальный Go microservice (gRPC + PostgreSQL)
|   |-- django-api-CLAUDE.md      # Реальный Django REST API (DRF + Celery)
|   |-- laravel-api-CLAUDE.md     # Реальный Laravel API (PostgreSQL + Redis) (НОВОЕ)
|   |-- rust-api-CLAUDE.md        # Реальный Rust API (Axum + SQLx + PostgreSQL) (НОВОЕ)
|
|-- mcp-configs/      # Конфигурации MCP-серверов
|   |-- mcp-servers.json    # GitHub, Supabase, Vercel, Railway и т.д.
|
|-- ecc_dashboard.py  # Настольная GUI-панель управления (Tkinter)
|
|-- assets/           # Assets для dashboard
|   |-- images/
|       |-- ecc-logo.png
|
|-- marketplace.json  # Self-hosted marketplace config (для /plugin marketplace add)
```

---

## Инструменты экосистемы

### Skill Creator

Два способа генерировать навыки Claude Code из вашего репозитория:

#### Вариант A: локальный анализ (встроенный)

Используйте команду `/skill-create` для локального анализа без внешних сервисов:

```bash
/skill-create                    # Анализировать текущий репозиторий
/skill-create --instincts        # Также генерировать инстинкты для continuous-learning-v2
```

Это локально анализирует вашу историю Git и генерирует файлы SKILL.md.

#### Вариант B: GitHub App (продвинутый)

Для продвинутых возможностей (10k+ коммитов, auto-PR, командный обмен):

[Установить GitHub App](https://github.com/apps/skill-creator) | [ecc.tools](https://ecc.tools)

```bash
# Оставьте комментарий в любом issue:
/skill-creator analyze

# Или автозапуск при push в default branch
```

Оба варианта создают:
- **файлы SKILL.md** — готовые к использованию навыки для Claude Code
- **коллекции инстинктов** — для continuous-learning-v2
- **извлечение паттернов** — обучение на вашей истории коммитов

### AgentShield — аудитор безопасности

> Создан на Claude Code Hackathon (Cerebral Valley x Anthropic, февраль 2026). 1282 теста, 98% покрытия, 102 правила статического анализа.

Сканирует вашу конфигурацию Claude Code на уязвимости, неправильные настройки и риски инъекций.

```bash
# Быстрое сканирование (установка не нужна)
npx ecc-agentshield scan

# Автоисправление безопасных проблем
npx ecc-agentshield scan --fix

# Глубокий анализ с тремя агентами Opus 4.6
npx ecc-agentshield scan --opus --stream

# Генерировать безопасный конфиг с нуля
npx ecc-agentshield init
```

**Что сканируется:** CLAUDE.md, settings.json, MCP configs, хуки, определения агентов и навыки по 5 категориям: обнаружение секретов (14 паттернов), аудит разрешений, анализ hook injection, профилирование рисков MCP-серверов и ревью конфигураций агентов.

**Флаг `--opus`** запускает три агента Claude Opus 4.6 в pipeline red-team/blue-team/auditor. Атакующий ищет цепочки эксплойтов, защитник оценивает защиты, а аудитор синтезирует оба результата в приоритизированную оценку рисков. Это adversarial reasoning, а не просто matching паттернов.

**Форматы вывода:** терминал (цветовая оценка A-F), JSON (CI pipelines), Markdown, HTML. Exit code 2 при критических находках для build gates.

Используйте `/security-scan` в Claude Code, чтобы запустить его, или добавьте в CI через [GitHub Action](https://github.com/affaan-m/agentshield).

[GitHub](https://github.com/affaan-m/agentshield) | [npm](https://www.npmjs.com/package/ecc-agentshield)

### Непрерывное обучение v2

Система обучения на основе инстинктов автоматически изучает ваши паттерны:

```bash
/instinct-status        # Показать изученные инстинкты с уверенностью
/instinct-import <file> # Импортировать инстинкты от других
/instinct-export        # Экспортировать ваши инстинкты для обмена
/evolve                 # Кластеризовать связанные инстинкты в skills
```

Полную документацию смотрите в `skills/continuous-learning-v2/`.
Оставляйте `continuous-learning/` только если вам явно нужен legacy v1 Stop-hook поток learned-skill.

---

## Требования

### Версия Claude Code CLI

**Минимальная версия: v2.1.0 или новее**

Этот плагин требует Claude Code CLI v2.1.0+ из-за изменений в том, как система плагинов обрабатывает хуки.

Проверьте версию:
```bash
claude --version
```

### Важно: поведение автозагрузки хуков

> ПРЕДУПРЕЖДЕНИЕ: **Для контрибьюторов:** НЕ добавляйте поле `"hooks"` в `.claude-plugin/plugin.json`. Это закреплено регрессионным тестом.

Claude Code v2.1+ **автоматически загружает** `hooks/hooks.json` из любого установленного плагина по соглашению. Явное объявление в `plugin.json` вызывает ошибку обнаружения дубликата:

```
Duplicate hooks file detected: ./hooks/hooks.json resolves to already-loaded file
```

**История:** это уже приводило к повторяющимся циклам fix/revert в репозитории ([#29](https://github.com/affaan-m/everything-claude-code/issues/29), [#52](https://github.com/affaan-m/everything-claude-code/issues/52), [#103](https://github.com/affaan-m/everything-claude-code/issues/103)). Поведение менялось между версиями Claude Code, что вызывало путаницу. Теперь есть регрессионный тест, который не даёт вернуть эту ошибку.

---

## Установка

### Вариант 1: установить как плагин (рекомендуется)

Самый простой способ использовать этот репозиторий — установить его как плагин Claude Code:

```bash
# Добавить этот репозиторий как marketplace
/plugin marketplace add https://github.com/affaan-m/everything-claude-code

# Установить плагин
/plugin install ecc@ecc
```

Или добавьте напрямую в `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "ecc": {
      "source": {
        "source": "github",
        "repo": "affaan-m/everything-claude-code"
      }
    }
  },
  "enabledPlugins": {
    "ecc@ecc": true
  }
}
```

Это сразу даёт доступ ко всем командам, агентам, навыкам и хукам.

> **Примечание:** система плагинов Claude Code не поддерживает распространение `rules` через плагины ([ограничение upstream](https://code.claude.com/docs/en/plugins-reference)). Правила нужно установить вручную:
>
> ```bash
> # Сначала клонируйте репозиторий
> git clone https://github.com/affaan-m/everything-claude-code.git
>
> # Вариант A: правила user-level (применяются ко всем проектам)
> mkdir -p ~/.claude/rules/ecc
> cp -r everything-claude-code/rules/common ~/.claude/rules/ecc/
> cp -r everything-claude-code/rules/typescript ~/.claude/rules/ecc/   # выберите свой стек
> cp -r everything-claude-code/rules/python ~/.claude/rules/ecc/
> cp -r everything-claude-code/rules/golang ~/.claude/rules/ecc/
> cp -r everything-claude-code/rules/php ~/.claude/rules/ecc/
>
> # Вариант B: правила project-level (применяются только к текущему проекту)
> mkdir -p .claude/rules/ecc
> cp -r everything-claude-code/rules/common .claude/rules/ecc/
> cp -r everything-claude-code/rules/typescript .claude/rules/ecc/     # выберите свой стек
> ```

---

### Вариант 2: ручная установка

Если вам нужен ручной контроль над тем, что устанавливается:

```bash
# Клонировать репозиторий
git clone https://github.com/affaan-m/everything-claude-code.git

# Скопировать агентов в ваш конфиг Claude
cp everything-claude-code/agents/*.md ~/.claude/agents/

# Скопировать директории правил (common + language-specific)
mkdir -p ~/.claude/rules/ecc
cp -r everything-claude-code/rules/common ~/.claude/rules/ecc/
cp -r everything-claude-code/rules/typescript ~/.claude/rules/ecc/   # выберите свой стек
cp -r everything-claude-code/rules/python ~/.claude/rules/ecc/
cp -r everything-claude-code/rules/golang ~/.claude/rules/ecc/
cp -r everything-claude-code/rules/php ~/.claude/rules/ecc/

# Сначала скопировать навыки (основной рабочий интерфейс)
# Рекомендуется для новых пользователей: только core/general skills
mkdir -p ~/.claude/skills/ecc
cp -r everything-claude-code/.agents/skills/* ~/.claude/skills/ecc/
cp -r everything-claude-code/skills/search-first ~/.claude/skills/ecc/

# Опционально: добавляйте нишевые/framework-specific skills только при необходимости
# for s in django-patterns django-tdd laravel-patterns springboot-patterns; do
# cp -r everything-claude-code/skills/$s ~/.claude/skills/ecc/
# done

# Опционально: сохранить поддерживаемую slash-command совместимость во время миграции
mkdir -p ~/.claude/commands
cp everything-claude-code/commands/*.md ~/.claude/commands/

# Retired shims находятся в legacy-command-shims/commands/.
# Копируйте отдельные файлы оттуда только если вам всё ещё нужны старые имена вроде /tdd.
```

#### Установить хуки

Не копируйте сырой repo-файл `hooks/hooks.json` в `~/.claude/settings.json` или `~/.claude/hooks/hooks.json`. Этот файл ориентирован на плагин/репозиторий и должен устанавливаться через установщик ECC или загружаться как плагин, поэтому прямое копирование не является поддерживаемым ручным способом установки.

Используйте установщик, чтобы установить только Claude hook runtime и корректно переписать пути команд:

```bash
# macOS / Linux
bash ./install.sh --target claude --modules hooks-runtime
```

```powershell
# Windows PowerShell
pwsh -File .\install.ps1 --target claude --modules hooks-runtime
```

Это записывает разрешённые хуки в `~/.claude/hooks/hooks.json` и не трогает существующий `~/.claude/settings.json`.

Если вы установили ECC через `/plugin install`, не копируйте эти хуки в `settings.json`. Claude Code v2.1+ уже автоматически загружает plugin `hooks/hooks.json`, а дублирование в `settings.json` вызывает двойное выполнение и кроссплатформенные конфликты хуков.

Примечание для Windows: директория конфигурации Claude — `%USERPROFILE%\\.claude`, а не `~/claude`.

#### Настроить MCP

Установки Claude plugin намеренно не включают автоматически bundled MCP server definitions ECC. Это предотвращает слишком длинные имена plugin MCP tools на строгих сторонних gateway, но оставляет доступной ручную настройку MCP.

Для live-изменений серверов Claude Code используйте команду Claude Code `/mcp` или CLI-managed MCP setup. Используйте `/mcp` для отключений во время выполнения Claude Code; Claude Code сохраняет эти решения в `~/.claude.json`.

Для repo-local MCP-доступа скопируйте нужные определения MCP-серверов из `mcp-configs/mcp-servers.json` в project-scoped `.mcp.json`.

Если у вас уже запущены собственные копии MCP, bundled в ECC, задайте:

```bash
export ECC_DISABLED_MCPS="github,context7,exa,playwright,sequential-thinking,memory"
```

ECC-managed install и Codex sync flows будут пропускать или удалять эти bundled servers вместо повторного добавления дубликатов. `ECC_DISABLED_MCPS` — это фильтр установки/синхронизации ECC, а не live-переключатель Claude Code.

**Важно:** замените placeholders `YOUR_*_HERE` на реальные API keys.

---

## Ключевые концепции

### Агенты

Субагенты выполняют делегированные задачи с ограниченной областью. Пример:

```markdown
---
name: code-reviewer
description: Проверяет код на качество, безопасность и сопровождаемость
tools: ["Read", "Grep", "Glob", "Bash"]
model: opus
---

Вы — senior code reviewer...
```

### Навыки

Навыки — основной рабочий интерфейс. Их можно вызывать напрямую, предлагать автоматически и переиспользовать агентами. ECC всё ещё поставляет поддерживаемые `commands/` во время миграции, а retired short-name shims живут в `legacy-command-shims/` только для явного opt-in. Новая разработка рабочих процессов должна сначала попадать в `skills/`.

```markdown
# TDD Workflow

1. Сначала определите интерфейсы
2. Напишите падающие тесты (RED)
3. Реализуйте минимальный код (GREEN)
4. Выполните рефакторинг (IMPROVE)
5. Проверьте покрытие 80%+
```

### Хуки

Хуки срабатывают на события инструментов. Пример — предупреждение о `console.log`:

```json
{
  "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\\\.(ts|tsx|js|jsx)$\"",
  "hooks": [{
    "type": "command",
    "command": "#!/bin/bash\ngrep -n 'console\\.log' \"$file_path\" && echo '[Hook] Remove console.log' >&2"
  }]
}
```

### Правила

Правила — always-follow guidelines, организованные в `common/` (языконезависимые) и language-specific директории:

```
rules/
  common/          # Универсальные принципы (устанавливайте всегда)
  typescript/      # TS/JS-specific patterns and tools
  python/          # Python-specific patterns and tools
  golang/          # Go-specific patterns and tools
  swift/           # Swift-specific patterns and tools
  php/             # PHP-specific patterns and tools
```

Детали установки и структуры смотрите в [`rules/README.md`](../../rules/README.md).

---

## Какого агента использовать?

Не знаете, с чего начать? Используйте эту краткую справку. Skills — канонический рабочий интерфейс; поддерживаемые slash entries остаются доступными для command-first workflows.

| Я хочу... | Использовать | Агент |
|-----------|---------------|-------|
| Спланировать новую функцию | `/ecc:plan "Добавить auth"` | planner |
| Спроектировать архитектуру системы | `/ecc:plan` + агент architect | architect |
| Писать код сначала через тесты | skill `tdd-workflow` | tdd-guide |
| Проверить только что написанный код | `/code-review` | code-reviewer |
| Исправить падающую сборку | `/build-fix` | build-error-resolver |
| Запустить end-to-end тесты | skill `e2e-testing` | e2e-runner |
| Найти уязвимости безопасности | `/security-scan` | security-reviewer |
| Удалить мёртвый код | `/refactor-clean` | refactor-cleaner |
| Обновить документацию | `/update-docs` | doc-updater |
| Проверить Go-код | `/go-review` | go-reviewer |
| Проверить Python-код | `/python-review` | python-reviewer |
| Проверить TypeScript/JavaScript код | *(вызовите `typescript-reviewer` напрямую)* | typescript-reviewer |
| Аудит database queries | *(делегируется автоматически)* | database-reviewer |

### Типовые рабочие процессы

Slash-формы ниже показаны там, где они остаются частью поддерживаемого командного интерфейса. Retired short-name shims вроде `/tdd` и `/eval` живут в `legacy-command-shims/` только для явного opt-in.

**Начало новой функции:**
```
/ecc:plan "Добавить OAuth-аутентификацию пользователей"
                                              → planner создаёт blueprint реализации
tdd-workflow skill                            → tdd-guide принуждает писать тесты сначала
/code-review                                  → code-reviewer проверяет работу
```

**Исправление ошибки:**
```
tdd-workflow skill                            → tdd-guide: написать падающий тест, который воспроизводит ошибку
                                              → реализовать исправление, убедиться, что тест проходит
/code-review                                  → code-reviewer: поймать регрессии
```

**Подготовка к продакшену:**
```
/security-scan                                → security-reviewer: аудит OWASP Top 10
e2e-testing skill                             → e2e-runner: тесты критических пользовательских потоков
/test-coverage                                → проверить покрытие 80%+
```

---

## FAQ

<details>
<summary><b>Как проверить, какие агенты/команды установлены?</b></summary>

```bash
/plugin list ecc@ecc
```

Показывает всех доступных агентов, команды и навыки из плагина.
</details>

<details>
<summary><b>Хуки не работают / я вижу ошибки "Duplicate hooks file"</b></summary>

Это самая частая проблема. **НЕ добавляйте поле `"hooks"` в `.claude-plugin/plugin.json`.** Claude Code v2.1+ автоматически загружает `hooks/hooks.json` из установленных плагинов. Явное объявление вызывает ошибки обнаружения дубликатов. См. [#29](https://github.com/affaan-m/everything-claude-code/issues/29), [#52](https://github.com/affaan-m/everything-claude-code/issues/52), [#103](https://github.com/affaan-m/everything-claude-code/issues/103).
</details>

<details>
<summary><b>Можно ли использовать ECC с Claude Code на custom API endpoint или model gateway?</b></summary>

Да. ECC не хардкодит транспортные настройки Anthropic-hosted окружения. Он запускается локально через обычный CLI/plugin-интерфейс Claude Code, поэтому работает с:

- Anthropic-hosted Claude Code
- официальными Claude Code gateway-настройками через `ANTHROPIC_BASE_URL` и `ANTHROPIC_AUTH_TOKEN`
- совместимыми custom endpoints, которые говорят на Anthropic API, ожидаемом Claude Code

Минимальный пример:

```bash
export ANTHROPIC_BASE_URL=https://your-gateway.example.com
export ANTHROPIC_AUTH_TOKEN=your-token
claude
```

Если ваш gateway переименовывает модели, настраивайте это в Claude Code, а не в ECC. Хуки, навыки, команды и правила ECC не зависят от model provider, если CLI `claude` уже работает.

Официальные ссылки:
- [Claude Code LLM gateway docs](https://docs.anthropic.com/en/docs/claude-code/llm-gateway)
- [Claude Code model configuration docs](https://docs.anthropic.com/en/docs/claude-code/model-config)

</details>

<details>
<summary><b>Контекстное окно сжимается / у Claude заканчивается контекст</b></summary>

Слишком много MCP-серверов съедают контекст. Каждое описание MCP tool потребляет токены из вашего окна 200k, потенциально сокращая его до ~70k. Контекст SessionStart по умолчанию ограничен 8000 символами; уменьшите его через `ECC_SESSION_START_MAX_CHARS=4000` или отключите через `ECC_SESSION_START_CONTEXT=off` для local-model или low-context setups.

**Решение:** отключите неиспользуемые MCP в Claude Code через `/mcp`. Claude Code записывает эти runtime-решения в `~/.claude.json`; `.claude/settings.json` и `.claude/settings.local.json` не являются надёжными переключателями для уже загруженных MCP-серверов.

Держите включёнными менее 10 MCP и менее 80 активных tools.
</details>

<details>
<summary><b>Можно ли использовать только часть компонентов, например только агентов?</b></summary>

Да. Используйте вариант 2 (ручная установка) и копируйте только то, что нужно:

```bash
# Только агенты
cp everything-claude-code/agents/*.md ~/.claude/agents/

# Только правила
mkdir -p ~/.claude/rules/ecc/
cp -r everything-claude-code/rules/common ~/.claude/rules/ecc/
```

Каждый компонент полностью независим.
</details>

<details>
<summary><b>Работает ли это с Cursor / OpenCode / Codex / Antigravity?</b></summary>

Да. ECC кроссплатформенный:
- **Cursor**: предварительно адаптированные конфиги в `.cursor/`. См. [Поддержка Cursor IDE](#поддержка-cursor-ide).
- **Gemini CLI**: экспериментальная project-local поддержка через `.gemini/GEMINI.md` и общий plumbing установщика.
- **OpenCode**: полная поддержка плагина в `.opencode/`. См. [Поддержка OpenCode](#поддержка-opencode).
- **Codex**: первоклассная поддержка macOS app и CLI, с guards против adapter drift и SessionStart fallback. См. PR [#257](https://github.com/affaan-m/everything-claude-code/pull/257).
- **Antigravity**: плотная настройка для workflows, skills и flattened rules в `.agent/`. См. [Antigravity Guide](../ANTIGRAVITY-GUIDE.md).
- **Ненативные среды**: ручной fallback path для Grok и похожих интерфейсов. См. [Manual Adaptation Guide](../MANUAL-ADAPTATION-GUIDE.md).
- **Claude Code**: нативно — это основная цель.
</details>

<details>
<summary><b>Как внести новый skill или agent?</b></summary>

См. [CONTRIBUTING.md](../../CONTRIBUTING.md). Короткая версия:
1. Форкните репозиторий
2. Создайте skill в `skills/your-skill-name/SKILL.md` (с YAML frontmatter)
3. Или создайте агента в `agents/your-agent.md`
4. Отправьте PR с понятным описанием того, что он делает и когда его использовать
</details>

---

## Запуск тестов

Плагин включает комплексный набор тестов:

```bash
# Запустить все тесты
node tests/run-all.js

# Запустить отдельные файлы тестов
node tests/lib/utils.test.js
node tests/lib/package-manager.test.js
node tests/hooks/hooks.test.js
```

---

## Вклад в проект

**Вклад приветствуется и поощряется.**

Этот репозиторий задуман как ресурс сообщества. Если у вас есть:
- полезные агенты или навыки
- умные хуки
- более удачные MCP-конфигурации
- улучшенные правила

Пожалуйста, внесите вклад. См. [CONTRIBUTING.md](../../CONTRIBUTING.md) для рекомендаций.

### Идеи для вклада

- Language-specific skills (Rust, C#, Kotlin, Java) — Go, Python, Perl, Swift и TypeScript уже включены
- Framework-specific configs (Rails, FastAPI) — Django, NestJS, Spring Boot и Laravel уже включены
- DevOps-агенты (Kubernetes, Terraform, AWS, Docker)
- Стратегии тестирования (разные фреймворки, визуальная регрессия)
- Предметные знания (ML, data engineering, mobile)

### Заметки об экосистеме сообщества

Они не поставляются вместе с ECC и не аудируются этим репозиторием, но о них стоит знать, если вы изучаете более широкую экосистему Claude Code skills:

- [claude-seo](https://github.com/AgriciDaniel/claude-seo) — SEO-focused коллекция skills и agents
- [claude-ads](https://github.com/AgriciDaniel/claude-ads) — коллекция ad-audit и paid-growth workflows
- [claude-cybersecurity](https://github.com/AgriciDaniel/claude-cybersecurity) — security-oriented коллекция skills и agents

---

## Поддержка Cursor IDE

ECC предоставляет поддержку Cursor IDE с хуками, правилами, агентами, навыками, командами и MCP-конфигами, адаптированными под layout проекта Cursor.

### Быстрый старт (Cursor)

```bash
# macOS/Linux
./install.sh --target cursor typescript
./install.sh --target cursor python golang swift php
```

```powershell
# Windows PowerShell
.\install.ps1 --target cursor typescript
.\install.ps1 --target cursor python golang swift php
```

### Что включено

| Компонент | Количество | Детали |
|-----------|------------|--------|
| Hook Events | 15 | sessionStart, beforeShellExecution, afterFileEdit, beforeMCPExecution, beforeSubmitPrompt и ещё 10 |
| Hook Scripts | 16 | Тонкие Node.js скрипты, делегирующие в `scripts/hooks/` через общий adapter |
| Rules | 34 | 9 common (alwaysApply) + 25 language-specific (TypeScript, Python, Go, Swift, PHP) |
| Agents | 50 | `.cursor/agents/ecc-*.md` при установке; с префиксом, чтобы избежать конфликтов с user или marketplace agents |
| Skills | Shared + Bundled | `.cursor/skills/` для адаптированных дополнений |
| Commands | Shared | `.cursor/commands/` при установке |
| MCP Config | Shared | `.cursor/mcp.json` при установке |

### Заметки о загрузке Cursor

ECC не устанавливает root `AGENTS.md` в `.cursor/`. Cursor воспринимает вложенные `AGENTS.md` как directory context, поэтому копирование identity ECC-репозитория в host project загрязняло бы этот проект.

Cursor-native loading behavior может различаться между сборками Cursor. ECC устанавливает агентов как `.cursor/agents/ecc-*.md`; если ваша сборка Cursor не показывает project agents, эти файлы всё равно работают как явные reference definitions, а не скрытый global prompt context.

### Архитектура хуков (DRY adapter pattern)

В Cursor **больше hook events, чем в Claude Code** (20 против 8). Модуль `.cursor/hooks/adapter.js` преобразует stdin JSON Cursor в формат Claude Code, позволяя переиспользовать существующие `scripts/hooks/*.js` без дублирования.

```
Cursor stdin JSON → adapter.js → transforms → scripts/hooks/*.js
                                              (shared with Claude Code)
```

Ключевые хуки:
- **beforeShellExecution** — блокирует dev servers вне tmux (exit 2), review перед git push
- **afterFileEdit** — auto-format + TypeScript check + предупреждение о console.log
- **beforeSubmitPrompt** — обнаруживает секреты (паттерны sk-, ghp_, AKIA) в prompts
- **beforeTabFileRead** — блокирует чтение Tab файлов .env, .key, .pem (exit 2)
- **beforeMCPExecution / afterMCPExecution** — MCP audit logging

### Формат правил

Правила Cursor используют YAML frontmatter с `description`, `globs` и `alwaysApply`:

```yaml
---
description: "TypeScript coding style extending common rules"
globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]
alwaysApply: false
---
```

---

## Поддержка Codex macOS App + CLI

ECC предоставляет **первоклассную поддержку Codex** как для macOS app, так и для CLI: reference configuration, Codex-specific supplement `AGENTS.md` и общие skills.

### Быстрый старт (Codex App + CLI)

```bash
# Запустить Codex CLI в репозитории — AGENTS.md и .codex/ определяются автоматически
codex

# Автоматическая настройка: синхронизировать assets ECC (AGENTS.md, skills, MCP servers) в ~/.codex
npm install && bash scripts/sync-ecc-to-codex.sh
# или: pnpm install && bash scripts/sync-ecc-to-codex.sh
# или: yarn install && bash scripts/sync-ecc-to-codex.sh
# или: bun install && bash scripts/sync-ecc-to-codex.sh

# Или вручную: скопировать reference config в домашнюю директорию
cp .codex/config.toml ~/.codex/config.toml
```

Sync script безопасно сливает MCP-серверы ECC в существующий `~/.codex/config.toml` через стратегию **add-only**: он никогда не удаляет и не изменяет ваши существующие серверы. Запускайте с `--dry-run`, чтобы посмотреть изменения, или с `--update-mcp`, чтобы принудительно обновить ECC-серверы до последнего рекомендуемого конфига.

Для Context7 ECC использует каноническое имя секции Codex `[mcp_servers.context7]`, но всё ещё запускает пакет `@upstash/context7-mcp`. Если у вас уже есть legacy-запись `[mcp_servers.context7-mcp]`, `--update-mcp` мигрирует её на каноническое имя секции.

Codex macOS app:
- Откройте этот репозиторий как workspace.
- Root `AGENTS.md` определяется автоматически.
- `.codex/config.toml` и `.codex/agents/*.toml` лучше всего работают, когда остаются project-local.
- Reference `.codex/config.toml` намеренно не фиксирует `model` или `model_provider`, поэтому Codex использует свой текущий default, если вы его не переопределили.
- Опционально: скопируйте `.codex/config.toml` в `~/.codex/config.toml` для global defaults; multi-agent role files оставляйте project-local, если также не копируете `.codex/agents/`.

### Что включено

| Компонент | Количество | Детали |
|-----------|------------|--------|
| Config | 1 | `.codex/config.toml` — top-level approvals/sandbox/web_search, MCP servers, notifications, profiles |
| AGENTS.md | 2 | Root (universal) + `.codex/AGENTS.md` (Codex-specific supplement) |
| Skills | 32 | `.agents/skills/` — SKILL.md + agents/openai.yaml для каждого skill |
| MCP Servers | 6 | GitHub, Context7, Exa, Memory, Playwright, Sequential Thinking (7 с Supabase через `--update-mcp` sync) |
| Profiles | 2 | `strict` (read-only sandbox) и `yolo` (full auto-approve) |
| Agent Roles | 3 | `.codex/agents/` — explorer, reviewer, docs-researcher |

### Skills

Skills в `.agents/skills/` автоматически загружаются Codex:

Канонические Anthropic skills вроде `claude-api`, `frontend-design` и `skill-creator` намеренно не переупакованы здесь. Устанавливайте их из [`anthropics/skills`](https://github.com/anthropics/skills), когда нужны официальные версии.

| Skill | Описание |
|-------|----------|
| agent-introspection-debugging | Отладка поведения агентов, routing и prompt boundaries |
| agent-sort | Сортировка каталогов агентов и assignment surfaces |
| api-design | Паттерны REST API design |
| article-writing | Long-form writing из заметок и voice references |
| backend-patterns | API design, database, caching |
| brand-voice | Source-derived writing style profiles из реального контента |
| bun-runtime | Bun как runtime, package manager, bundler и test runner |
| coding-standards | Универсальные coding standards |
| content-engine | Platform-native social content и repurposing |
| crosspost | Multi-platform distribution по X, LinkedIn, Threads |
| deep-research | Multi-source research с synthesis и source attribution |
| dmux-workflows | Multi-agent orchestration через tmux pane manager |
| documentation-lookup | Актуальные docs библиотек и фреймворков через Context7 MCP |
| e2e-testing | Playwright E2E tests |
| eval-harness | Eval-driven development |
| everything-claude-code | Development conventions и patterns для проекта |
| exa-search | Neural search через Exa MCP для web, code, company research |
| fal-ai-media | Unified media generation для images, video и audio |
| frontend-patterns | React/Next.js patterns |
| frontend-slides | HTML presentations, PPTX conversion, visual style exploration |
| investor-materials | Decks, memos, models и one-pagers |
| investor-outreach | Personalized outreach, follow-ups и intro blurbs |
| market-research | Market и competitor research с атрибуцией источников |
| mcp-server-patterns | Build MCP servers with Node/TypeScript SDK |
| nextjs-turbopack | Next.js 16+ и Turbopack incremental bundling |
| product-capability | Перевод product goals в scoped capability maps |
| security-review | Комплексный чеклист безопасности |
| strategic-compact | Управление контекстом |
| tdd-workflow | Test-driven development с 80%+ coverage |
| verification-loop | Build, test, lint, typecheck, security |
| video-editing | AI-assisted video editing workflows с FFmpeg и Remotion |
| x-api | Интеграция X/Twitter API для posting и analytics |

### Ключевое ограничение

Codex **пока не предоставляет parity с Claude-style hook execution**. Принуждение ECC там instruction-based через `AGENTS.md`, опциональные overrides `model_instructions_file` и настройки sandbox/approval.

### Поддержка multi-agent

Текущие сборки Codex поддерживают стабильные multi-agent workflows.

- Включите `features.multi_agent = true` в `.codex/config.toml`
- Определите роли в `[agents.<name>]`
- Направьте каждую роль на файл в `.codex/agents/`
- Используйте `/agent` в CLI, чтобы inspect или steer child agents

ECC поставляет три sample role configs:

| Роль | Назначение |
|------|------------|
| `explorer` | Read-only сбор доказательств по кодовой базе перед правками |
| `reviewer` | Ревью correctness, security и missing tests |
| `docs_researcher` | Проверка документации и API перед release/docs changes |

---

## Поддержка OpenCode

ECC предоставляет **полную поддержку OpenCode**, включая плагины и хуки.

### Быстрый старт

```bash
# Установить OpenCode
npm install -g opencode

# Запустить в корне репозитория
opencode
```

Конфигурация автоматически определяется из `.opencode/opencode.json`.

### Паритет возможностей

| Возможность | Claude Code | OpenCode | Статус |
|-------------|-------------|----------|--------|
| Agents | PASS: 50 agents | PASS: 12 agents | **Claude Code впереди** |
| Commands | PASS: 68 commands | PASS: 31 commands | **Claude Code впереди** |
| Skills | PASS: 185 skills | PASS: 37 skills | **Claude Code впереди** |
| Hooks | PASS: 8 event types | PASS: 11 events | **В OpenCode больше** |
| Rules | PASS: 29 rules | PASS: 13 instructions | **Claude Code впереди** |
| MCP Servers | PASS: 14 servers | PASS: Full | **Полный паритет** |
| Custom Tools | PASS: Via hooks | PASS: 6 native tools | **OpenCode лучше** |

### Поддержка хуков через плагины

Система плагинов OpenCode БОЛЕЕ продвинута, чем Claude Code, и имеет 20+ типов событий:

| Claude Code Hook | OpenCode Plugin Event |
|------------------|----------------------|
| PreToolUse | `tool.execute.before` |
| PostToolUse | `tool.execute.after` |
| Stop | `session.idle` |
| SessionStart | `session.created` |
| SessionEnd | `session.deleted` |

**Дополнительные события OpenCode**: `file.edited`, `file.watcher.updated`, `message.updated`, `lsp.client.diagnostics`, `tui.toast.show` и другие.

### Поддерживаемые slash-записи

| Команда | Описание |
|---------|----------|
| `/plan` | Создать план реализации |
| `/code-review` | Проверить изменения кода |
| `/build-fix` | Исправить ошибки сборки |
| `/refactor-clean` | Удалить мёртвый код |
| `/learn` | Извлечь паттерны из сессии |
| `/checkpoint` | Сохранить состояние верификации |
| `/quality-gate` | Запустить поддерживаемый verification gate |
| `/update-docs` | Обновить документацию |
| `/update-codemaps` | Обновить codemaps |
| `/test-coverage` | Проанализировать покрытие |
| `/go-review` | Ревью Go-кода |
| `/go-test` | Go TDD workflow |
| `/go-build` | Исправить ошибки сборки Go |
| `/python-review` | Ревью Python-кода (PEP 8, type hints, security) |
| `/multi-plan` | Multi-model collaborative planning |
| `/multi-execute` | Multi-model collaborative execution |
| `/multi-backend` | Backend-focused multi-model workflow |
| `/multi-frontend` | Frontend-focused multi-model workflow |
| `/multi-workflow` | Full multi-model development workflow |
| `/pm2` | Auto-generate PM2 service commands |
| `/sessions` | Управлять историей сессий |
| `/skill-create` | Генерировать skills из git |
| `/instinct-status` | Смотреть изученные инстинкты |
| `/instinct-import` | Импортировать инстинкты |
| `/instinct-export` | Экспортировать инстинкты |
| `/evolve` | Кластеризовать инстинкты в skills |
| `/promote` | Продвинуть project instincts в global scope |
| `/projects` | Перечислить известные проекты и статистику инстинктов |
| `/prune` | Удалить истёкшие pending-инстинкты (30d TTL) |
| `/learn-eval` | Извлечь и оценить паттерны перед сохранением |
| `/setup-pm` | Настроить package manager |
| `/harness-audit` | Аудитировать надёжность среды, eval readiness и risk posture |
| `/loop-start` | Запустить controlled agentic loop execution pattern |
| `/loop-status` | Проверить status и checkpoints активного loop |
| `/quality-gate` | Запустить quality gate checks для путей или всего repo |
| `/model-route` | Маршрутизировать задачи на модели по сложности и бюджету |

### Установка плагина

**Вариант 1: использовать напрямую**
```bash
cd everything-claude-code
opencode
```

**Вариант 2: установить как npm package**
```bash
npm install ecc-universal
```

Затем добавьте в `opencode.json`:
```json
{
  "plugin": ["ecc-universal"]
}
```

Эта npm plugin entry включает опубликованный OpenCode plugin module ECC (hooks/events и plugin tools).
Она **не** добавляет автоматически полный catalog команд/агентов/instructions ECC в конфиг вашего проекта.

Для полной настройки ECC OpenCode:
- запустите OpenCode внутри этого репозитория, или
- скопируйте bundled `.opencode/` config assets в ваш проект и подключите entries `instructions`, `agent` и `command` в `opencode.json`

### Документация

- **Migration Guide**: `.opencode/MIGRATION.md`
- **OpenCode Plugin README**: `.opencode/README.md`
- **Consolidated Rules**: `.opencode/instructions/INSTRUCTIONS.md`
- **LLM Documentation**: `llms.txt` (полная документация OpenCode для LLM)

---

## Паритет возможностей между инструментами

ECC — **первый плагин, который помогает максимально использовать каждый крупный инструмент AI-кодинга**. Вот как сравниваются среды:

| Возможность | Claude Code | Cursor IDE | Codex CLI | OpenCode |
|-------------|-------------|------------|-----------|----------|
| **Agents** | 50 | Shared (AGENTS.md) | Shared (AGENTS.md) | 12 |
| **Commands** | 68 | Shared | Instruction-based | 31 |
| **Skills** | 185 | Shared | 10 (native format) | 37 |
| **Hook Events** | 8 типов | 15 типов | Пока нет | 11 типов |
| **Hook Scripts** | 20+ scripts | 16 scripts (DRY adapter) | N/A | Plugin hooks |
| **Rules** | 34 (common + lang) | 34 (YAML frontmatter) | Instruction-based | 13 instructions |
| **Custom Tools** | Через hooks | Через hooks | N/A | 6 native tools |
| **MCP Servers** | 14 | Shared (mcp.json) | 7 (auto-merged через TOML parser) | Full |
| **Config Format** | settings.json | hooks.json + rules/ | config.toml | opencode.json |
| **Context File** | CLAUDE.md + AGENTS.md | AGENTS.md | AGENTS.md | AGENTS.md |
| **Secret Detection** | Hook-based | beforeSubmitPrompt hook | Sandbox-based | Hook-based |
| **Auto-Format** | PostToolUse hook | afterFileEdit hook | N/A | file.edited hook |
| **Version** | Plugin | Plugin | Reference config | 2.0.0-rc.1 |

**Ключевые архитектурные решения:**
- **AGENTS.md** в корне — универсальный cross-tool файл (читается всеми 4 инструментами)
- **DRY adapter pattern** позволяет Cursor переиспользовать hook scripts Claude Code без дублирования
- **Формат Skills** (SKILL.md с YAML frontmatter) работает в Claude Code, Codex и OpenCode
- Отсутствие хуков в Codex компенсируется `AGENTS.md`, опциональными overrides `model_instructions_file` и sandbox permissions

---

## Предыстория

Я использую Claude Code с экспериментального rollout. В сентябре 2025 выиграл Anthropic x Forum Ventures hackathon вместе с [@DRodriguezFX](https://x.com/DRodriguezFX) — мы построили [zenith.chat](https://zenith.chat) полностью с помощью Claude Code.

Эти конфиги проверены в бою на нескольких production-приложениях.

---

## Оптимизация токенов

Использование Claude Code может быть дорогим, если не управлять потреблением токенов. Эти настройки заметно снижают затраты без потери качества.

### Рекомендуемые настройки

Добавьте в `~/.claude/settings.json`:

```json
{
  "model": "sonnet",
  "env": {
    "MAX_THINKING_TOKENS": "10000",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"
  }
}
```

| Настройка | По умолчанию | Рекомендуется | Эффект |
|-----------|--------------|---------------|--------|
| `model` | opus | **sonnet** | ~60% снижение затрат; справляется с 80%+ coding tasks |
| `MAX_THINKING_TOKENS` | 31,999 | **10,000** | ~70% снижение скрытой стоимости thinking на request |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | 95 | **50** | Более ранняя compaction — лучшее качество в длинных сессиях |

Переключайтесь на Opus только когда нужно глубокое архитектурное рассуждение:
```
/model opus
```

### Команды ежедневного workflow

| Команда | Когда использовать |
|---------|--------------------|
| `/model sonnet` | Default для большинства задач |
| `/model opus` | Сложная архитектура, debugging, deep reasoning |
| `/clear` | Между несвязанными задачами (бесплатный мгновенный reset) |
| `/compact` | В логических точках разрыва задачи (исследование завершено, milestone готов) |
| `/cost` | Мониторинг расходов токенов во время сессии |

### Стратегическая компактификация

Навык `strategic-compact` (включён в этот плагин) предлагает `/compact` в логических точках, а не полагается на auto-compaction при 95% контекста. Полный decision guide смотрите в `skills/strategic-compact/SKILL.md`.

**Когда compact:**
- после research/exploration, перед implementation
- после завершения milestone, перед началом следующего
- после debugging, перед продолжением работы над feature
- после неудачного подхода, перед пробой нового

**Когда НЕ compact:**
- в середине implementation (потеряете имена переменных, пути файлов, partial state)

### Управление контекстным окном

**Критично:** не включайте все MCP сразу. Каждое описание MCP tool потребляет токены из вашего окна 200k, потенциально сокращая его до ~70k.

- Держите включёнными менее 10 MCP на проект
- Держите активными менее 80 tools
- Используйте `/mcp`, чтобы отключать неиспользуемые Claude Code MCP servers; эти runtime-решения сохраняются в `~/.claude.json`
- Используйте `ECC_DISABLED_MCPS` только для фильтрации MCP-конфигов, генерируемых ECC, во время install/sync flows

### Предупреждение о стоимости Agent Teams

Agent Teams создаёт несколько context windows. Каждый участник команды потребляет токены независимо. Используйте это только для задач, где параллелизм даёт явную пользу (multi-module work, parallel reviews). Для простых последовательных задач subagents эффективнее по токенам.

---

## Важные предупреждения

### Оптимизация токенов

Упираетесь в дневные лимиты? Смотрите **[Руководство по оптимизации токенов](../token-optimization.md)** с рекомендуемыми настройками и workflow-советами.

Быстрые выигрыши:

```json
// ~/.claude/settings.json
{
  "model": "sonnet",
  "env": {
    "MAX_THINKING_TOKENS": "10000",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50",
    "CLAUDE_CODE_SUBAGENT_MODEL": "haiku"
  }
}
```

Используйте `/clear` между несвязанными задачами, `/compact` в логических breakpoints и `/cost` для мониторинга расходов.

### Кастомизация

Эти конфиги работают для моего workflow. Вам стоит:
1. Начать с того, что резонирует
2. Адаптировать под ваш стек
3. Удалить то, чем не пользуетесь
4. Добавить собственные паттерны

---

## Проекты сообщества

Проекты, построенные на Everything Claude Code или вдохновлённые им:

| Проект | Описание |
|--------|----------|
| [EVC](https://github.com/SaigonXIII/evc) | Marketing agent workspace — 42 команды для content operators, brand governance и multi-channel publishing. [Визуальный обзор](https://saigonxiii.github.io/evc). |

Построили что-то с ECC? Откройте PR, чтобы добавить это сюда.

---

## Спонсоры

Этот проект бесплатный и open source. Спонсоры помогают поддерживать и развивать его.

[**Стать спонсором**](https://github.com/sponsors/affaan-m) | [Уровни спонсорства](../../SPONSORS.md) | [Программа спонсорства](../../SPONSORING.md)

---

## История звёзд

[![Star History Chart](https://api.star-history.com/svg?repos=affaan-m/everything-claude-code&type=Date)](https://star-history.com/#affaan-m/everything-claude-code&Date)

---

## Ссылки

- **Краткое руководство (начните здесь):** [The Shorthand Guide to Everything Claude Code](https://x.com/affaanmustafa/status/2012378465664745795)
- **Подробное руководство (продвинутый уровень):** [The Longform Guide to Everything Claude Code](https://x.com/affaanmustafa/status/2014040193557471352)
- **Руководство по безопасности:** [Security Guide](../../the-security-guide.md) | [Тред](https://x.com/affaanmustafa/status/2033263813387223421)
- **Подписаться:** [@affaanmustafa](https://x.com/affaanmustafa)

---

## Лицензия

MIT — используйте свободно, изменяйте по необходимости, вносите вклад, если можете.

---

**Поставьте звезду этому репозиторию, если он помогает. Прочитайте оба руководства. Создавайте сильные продукты.**
