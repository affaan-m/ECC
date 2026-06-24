# Worktree Map — Everything Claude Code (ECC)

> Mapeamento até 3 níveis de profundidade. Descricões derivadas da documentação do repositório
> (`README.md`, `SOUL.md`, `AGENTS.md`, `WORKING-CONTEXT.md`, `docs/SKILL-PLACEMENT-POLICY.md`).
> Gerado em 2026-06-24 contra o fork ECC (snapshot; pode divergir da repo de referência do autor).

---

## Raiz

| Item | Descrição |
|---|---|
| `CLAUDE.md` | Instruções inegociáveis para o agente; ponto de entrada do harness |
| `SOUL.md` | Identidade e princípios do produto (Agent-First, Test-Driven, Security-First) |
| `AGENTS.md` | Catálogo de agentes disponíveis e quando usar cada um |
| `RULES.md` | Referência rápida ao sistema de regras |
| `README.md` | Documentação pública; instalação, guias, multi-harness |
| `WORKING-CONTEXT.md` | Estado operacional atual do repo (branch, release, roadmap ECC 2.0) |
| `CONTRIBUTING.md` | Convenções de formato para agentes, skills, commands e hooks |
| `CHANGELOG.md` | Histórico de versões |
| `COMMANDS-QUICK-REF.md` | Referência rápida de todos os slash commands |
| `TROUBLESHOOTING.md` | Diagnóstico de problemas comuns |
| `SECURITY.md` | Política de segurança e disclosure responsável |
| `SPONSORING.md` / `SPONSORS.md` | Programa de sponsors do OSS |
| `the-longform-guide.md` | Guia extenso de uso do ECC |
| `the-shortform-guide.md` | Guia rápido de onboarding |
| `the-security-guide.md` | Guia de segurança aprofundado |
| `VERSION` | Versão corrente do pacote |
| `ecc_dashboard.py` | Dashboard Python de observabilidade (custo, sessões, métricas) |
| `agent.yaml` | Manifest de identidade cross-harness do agente ECC |
| `package.json` / `package-lock.json` / `yarn.lock` | Dependências Node.js |
| `pyproject.toml` | Configuração Python (testes, src/llm) |
| `eslint.config.js` / `commitlint.config.js` | Configuração de linting e commits |
| `install.sh` / `install.ps1` | Scripts de instalação (Linux/macOS e Windows) |
| `greptile.json` | Configuração de indexação de código (Greptile) |
| `.env.example` | Variáveis de ambiente documentadas |
| `gap-analysis.md` | *(gerado nesta sessão)* Análise de gap harness v2 × fork ECC |

---

## `.claude/` — Configuração nativa Claude Code

| Item | Descrição |
|---|---|
| `commands/` | Slash commands locais do projeto (`add-language-rules`, `database-migration`, `feature-development`) |
| `rules/` | Regras do projeto carregadas automaticamente (`node.md`, `everything-claude-code-guardrails.md`) |
| `skills/` | Skills locais ativas para esta sessão (`everything-claude-code`) |
| `enterprise/controls.md` | Controles de governança enterprise |
| `homunculus/instincts/` | Instintos aprendidos (continuous-learning-v2) — escopo de projeto |
| `research/` | Playbook de pesquisa do ECC |
| `team/` | Configuração de time (team-config.json) |
| `identity.json` | Identidade do agente para cross-harness |
| `ecc-tools.json` | Configuração de ferramentas ECC |
| `package-manager.json` | Detecção de gerenciador de pacotes (npm/yarn/pnpm/bun) |

---

## `agents/` — Agentes especializados (~67)

Agentes de delegação com frontmatter YAML (`name`, `description`, `tools`, `model`).
Cada agente é invocado proativamente quando o tipo de trabalho casa com seu domínio.

| Subgrupo | Exemplos | Função |
|---|---|---|
| **Revisores de linguagem** | `python-reviewer`, `rust-reviewer`, `go-reviewer`, `typescript-reviewer`, `kotlin-reviewer`, `swift-reviewer`, `java-reviewer`, `php-reviewer`, `cpp-reviewer`, `vue-reviewer`, `react-reviewer`, `django-reviewer`, `fastapi-reviewer`, `flutter-reviewer`, `fsharp-reviewer`, `csharp-reviewer` | Revisão de qualidade por ecossistema |
| **Resolvedores de build** | `build-error-resolver`, `react-build-resolver`, `rust-build-resolver`, `go-build-resolver`, `kotlin-build-resolver`, `java-build-resolver`, `cpp-build-resolver`, `swift-build-resolver`, `dart-build-resolver`, `pytorch-build-resolver`, `django-build-resolver`, `harmonyos-app-resolver` | Diagnóstico e correção de falhas de build |
| **Arquitetura** | `architect`, `code-architect`, `network-architect`, `homelab-architect` | Decisões de design de sistema |
| **Qualidade / Segurança** | `code-reviewer`, `security-reviewer`, `performance-optimizer`, `refactor-cleaner`, `code-simplifier`, `silent-failure-hunter` | Auditoria, simplificação e segurança |
| **Planejamento / Orquestração** | `planner`, `chief-of-staff`, `loop-operator`, `tdd-guide` | Estratégia, coordenação e TDD |
| **Domínios especializados** | `harness-optimizer`, `mle-reviewer`, `healthcare-reviewer`, `database-reviewer`, `network-config-reviewer`, `network-troubleshooter`, `type-design-analyzer`, `comment-analyzer`, `conversation-analyzer`, `a11y-architect`, `seo-specialist`, `marketing-agent` | Domínios verticais |
| **Eval / IA** | `agent-evaluator`, `gan-evaluator`, `gan-generator`, `gan-planner`, `pr-test-analyzer`, `spec-miner` | Avaliação de agentes e modelos |
| **Docs / Código** | `doc-updater`, `docs-lookup`, `code-explorer`, `e2e-runner` | Documentação e exploração |
| **Open Source** | `opensource-forker`, `opensource-packager`, `opensource-sanitizer` | Pipeline de OSS |

---

## `skills/` — Biblioteca de skills (~271)

Skills curadas — `SKILL.md` por pasta. Distribuídas via manifests. Não confundir com skills geradas/importadas, que ficam em `~/.claude/skills/`.

| Subgrupo | Exemplos | Função |
|---|---|---|
| **Harness / Agentes** | `agent-harness-construction`, `autonomous-agent-harness`, `agent-architecture-audit`, `eval-harness`, `agent-eval`, `agent-self-evaluation`, `agentic-engineering`, `agentic-os`, `continuous-agent-loop` | Construção, auditoria e avaliação do harness |
| **Conhecimento / Memória** | `knowledge-ops`, `recursive-decision-ledger`, `architecture-decision-records`, `continuous-learning-v2`, `context-budget`, `token-budget-advisor` | Gestão de KB, decisões e memória |
| **PM / Produto** | `product-capability`, `product-lens`, `intent-driven-development`, `plan-orchestrate`, `blueprint` | Especificação, AC e planejamento de produto |
| **Orquestração** | `team-agent-orchestration`, `team-builder`, `orch-*` (add-feature, build-mvp, change-feature, fix-defect, pipeline, refine-code) | Workflows multi-agente |
| **Avaliação / Qualidade** | `eval-harness`, `agent-eval`, `benchmark`, `benchmark-optimization-loop`, `verification-loop`, `ai-regression-testing` | Métricas, regressão e golden datasets |
| **Segurança** | `safety-guard`, `gateguard`, `security-review`, `security-scan`, `security-bounty-hunter`, `django-security`, `laravel-security`, `springboot-security`, `hipaa-compliance` | Guardrails, scanning e compliance |
| **Observabilidade / Custo** | `cost-tracking`, `cost-aware-llm-pipeline`, `dashboard-builder`, `canary-watch`, `automation-audit-ops` | Rastreamento de custo, dashboards e alertas |
| **Deployment / CI** | `deployment-patterns`, `git-workflow`, `github-ops`, `docker-patterns`, `kubernetes-patterns` | Pipeline de deploy e infra |
| **Padrões por linguagem** | `python-patterns`, `rust-patterns`, `golang-patterns`, `kotlin-patterns`, `react-patterns`, `vue-patterns`, `nodejs-*`, `django-patterns`, `fastapi-patterns`, `springboot-patterns`, `swift-*`, `java-coding-standards`, `cpp-coding-standards` | Convenções e padrões por ecossistema |
| **TDD / Testes** | `tdd-workflow`, `e2e-testing`, `django-tdd`, `laravel-tdd`, `springboot-tdd`, `quarkus-tdd`, `react-testing`, `python-testing`, `rust-testing`, `golang-testing`, `kotlin-testing` | Workflows de teste por stack |
| **Docs para agentes** | `documentation-lookup`, `rules-distill`, `skill-comply`, `skill-scout`, `skill-stocktake`, `ecc-guide`, `codebase-onboarding`, `code-tour` | Curadoria, validação e lookup de docs |
| **Pesquisa / IA** | `deep-research`, `search-first`, `prompt-optimizer`, `llm-trading-agent-security`, `recsys-pipeline-architect`, `scientific-thinking-*` | Pesquisa, otimização de prompts e IA aplicada |
| **Integração externa** | `jira-integration`, `google-workspace-ops`, `messages-ops`, `email-ops`, `unified-notifications-ops`, `x-api`, `exa-search`, `fal-ai-media`, `videodb` | Integrações com ferramentas externas |
| **Verticais** | `healthcare-*`, `homelab-*`, `defi-amm-security`, `customs-trade-compliance`, `energy-procurement`, `carrier-relationship-management` | Domínios de negócio específicos |
| **UX / Frontend** | `make-interfaces-feel-better`, `frontend-patterns`, `frontend-a11y`, `design-system`, `motion-*`, `liquid-glass-design`, `ui-demo`, `react-performance` | Design e performance de UI |

---

## `commands/` — Slash commands (~92)

Comandos invocáveis pelo usuário via `/nome`. Frontmatter `description:` obrigatório.

| Subgrupo | Exemplos | Função |
|---|---|---|
| **Qualidade / Revisão** | `code-review`, `security-scan`, `quality-gate`, `refactor-clean`, `test-coverage` | Auditorias e gates de qualidade |
| **Planejamento** | `plan`, `plan-prd`, `feature-dev`, `prp-plan`, `prp-prd`, `prp-implement`, `prp-commit`, `prp-pr` | Do PRD ao commit |
| **Orquestração multi-agente** | `multi-plan`, `multi-execute`, `multi-frontend`, `multi-backend`, `multi-workflow`, `orch-*` | Workflows paralelos / hierárquicos |
| **Epic / Backlog** | `epic-claim`, `epic-decompose`, `epic-publish`, `epic-review`, `epic-sync`, `epic-unblock`, `epic-validate` | Gestão de epics e backlog |
| **Sessão / Memória** | `save-session`, `resume-session`, `checkpoint`, `instinct-status`, `instinct-export`, `instinct-import`, `sessions` | Persistência e recuperação de contexto |
| **Harness / Diagnóstico** | `harness-audit`, `hookify`, `hookify-configure`, `hookify-list`, `hookify-help`, `model-route` | Auditoria e configuração do harness |
| **Aprendizado** | `learn`, `learn-eval`, `skill-create`, `skill-health`, `evolve`, `promote` | Extração de padrões e evolução de skills |
| **Por linguagem** | `go-build/review/test`, `kotlin-build/review/test`, `rust-build/review/test`, `react-build/review/test`, `flutter-build/review/test`, `cpp-build/review/test`, `python-review`, `fastapi-review`, `vue-review` | Build, revisão e teste por stack |
| **Infra / Deploy** | `pm2`, `setup-pm`, `auto-update`, `update-codemaps`, `update-docs`, `project-init` | Infraestrutura e inicialização |
| **Loops / GAN** | `loop-start`, `loop-status`, `santa-loop`, `gan-build`, `gan-design` | Execução contínua e pipelines GAN |
| **Integrações** | `jira`, `pr`, `review-pr`, `cost-report`, `marketing-campaign` | Jira, GitHub e relatórios |
| **Utilitários** | `aside`, `prune`, `projects`, `ecc-guide` | Atalhos e navegação |

---

## `hooks/` — Automações por gatilho

| Item | Descrição |
|---|---|
| `hooks.json` | Definição dos hooks ativos (matchers + comandos) |
| `README.md` | Documentação do sistema de hooks |
| `memory-persistence/` | Hook de persistência de memória entre sessões |

Os hooks do projeto executam via `scripts/hooks/run-with-flags.js` com suporte a `ECC_HOOK_PROFILE` e `ECC_DISABLED_HOOKS`. Tipos: `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`.

---

## `rules/` — Regras por linguagem / domínio

Diretrizes always-follow (segurança, estilo, testes). Organizadas por ecossistema.

| Pasta | Conteúdo |
|---|---|
| `common/` | Regras transversais (segurança, git, performance, agentes) |
| `python/`, `golang/`, `rust/`, `typescript/`, `kotlin/`, `swift/`, `java/`, `cpp/`, `csharp/`, `dart/`, `fsharp/`, `php/`, `perl/`, `ruby/` | Estilo, padrões, segurança e testes por linguagem |
| `react/`, `vue/`, `angular/`, `nuxt/`, `web/` | Regras de frontend por framework |

---

## `scripts/` — Utilitários Node.js

| Item | Descrição |
|---|---|
| `lib/` | Helpers compartilhados (package-manager, utils, install-*, session-*, mcp-*) |
| `hooks/` | Scripts de hook (run-with-flags.js, cost-tracker, gateguard, etc.) |
| `ci/` | Utilitários de CI (supply-chain, security scan) |
| `ecc.js` | CLI principal do ECC |
| `harness-audit.js` | Motor de auditoria determinística do harness |
| `catalog.js` | Geração do catálogo de agentes/skills/commands |
| `install-apply.js` / `install-plan.js` | Motor de instalação seletiva |
| `repair.js` | Auto-reparo de configuração |
| `doctor.js` | Diagnóstico do ambiente |
| `orchestrate-worktrees.js` | Orquestração de worktrees paralelas |
| `release.sh` / `release-approval-gate.js` | Pipeline de release |
| `skill-create-output.js` / `skills-health.js` | Geração e saúde de skills |
| `dashboard-web.js` / `ecc_dashboard.py` | Dashboards de observabilidade |
| `auto-update.js` | Auto-atualização do plugin |

---

## `tests/` — Suite de testes

Mirror de `scripts/`. Runner: `node tests/run-all.js`.

| Pasta | Descrição |
|---|---|
| `lib/` | Testes unitários dos helpers (`utils`, `package-manager`, `session-*`, `install-*`, `mcp-*`) |
| `hooks/` | Testes de integração de hooks (cost-tracker, gateguard, quality-gate, memory, etc.) |
| `commands/` | Testes de frontmatter e comportamento de commands |
| `ci/` | Testes de validação de CI (supply-chain, segurança, catálogo) |
| `docs/` | Testes de cobertura de documentação |
| `scripts/` | Testes de scripts utilitários |
| `integration/` | Testes de integração ponta-a-ponta |
| `run-all.js` | Orquestrador do suite completo |
| `test_*.py` | Testes Python para `src/llm` (providers, executor, resolver) |

---

## `docs/` — Documentação estendida

| Item | Descrição |
|---|---|
| `architecture/` | Arquitetura cross-harness, ECC 2.0 reference |
| `releases/` | Release notes por versão |
| `design/` | Decisões de design |
| `business/` | Materiais de negócio |
| `security/` | Guias de segurança |
| `fixes/` / `drafts/` | Correções pendentes e rascunhos |
| `HERMES-SETUP.md` | Guia de setup do operador Hermes (ECC 2.0) |
| `SKILL-PLACEMENT-POLICY.md` | Política de onde skills curadas vs. geradas vivem |
| `SKILL-DEVELOPMENT-GUIDE.md` | Guia de criação de skills |
| `SELECTIVE-INSTALL-*.md` | Arquitetura de instalação seletiva |
| `ECC-2.0-*.md` | Roadmap e arquitetura de referência do ECC 2.0 |
| `MCP-CONNECTOR-POLICY.md` | Política de conectores MCP |
| `pt-BR/`, `zh-CN/`, `ja-JP/`, `ko-KR/`, `de-DE/`, `es/`, `ru/`, `tr/`, `vi-VN/`, `th/`, `zh-TW/`, `ur/` | Traduções do README |

---

## Harnesses alternativos (cross-harness portability)

| Pasta | Harness | Conteúdo |
|---|---|---|
| `.agents/` | Genérico / marketplace | `plugins/marketplace.json` + subset de skills portadas |
| `.claude/` | Claude Code | Commands, rules, skills, enterprise controls |
| `.claude-plugin/` | Claude plugin marketplace | `plugin.json`, `marketplace.json` |
| `.codex/` | OpenAI Codex | `AGENTS.md`, `config.toml`, agentes `.toml` |
| `.codex-plugin/` | Codex plugin | `plugin.json` |
| `.cursor/` | Cursor | `hooks/`, `rules/` (por linguagem), `skills/` |
| `.codebuddy/` | CodeBuddy | Scripts de install/uninstall |
| `.gemini/` | Gemini CLI | `GEMINI.md` |
| `.kiro/` | Kiro | Agentes `.json`+`.md`, hooks `.kiro.hook`, skills, scripts, settings |
| `.opencode/` | OpenCode | Config, hooks, skills |
| `.qwen/` | Qwen | Config |
| `.trae/` | Trae | Config |
| `.zed/` | Zed | Config |
| `.vscode/` | VS Code | Config de workspace |

---

## Demais pastas

| Pasta | Descrição |
|---|---|
| `mcp-configs/` | Configurações de MCP servers (`mcp-servers.json`) |
| `manifests/` | Manifestos de instalação seletiva (`install-modules.json`) |
| `schemas/` | JSON schemas de validação |
| `contexts/` | Contextos de sessão (`dev.md`, `research.md`, `review.md`) |
| `integrations/` | Integrações externas (`aura/`) |
| `config/` | Mapeamentos de projeto e coordenação GitHub |
| `scaffolds/` | Templates de scaffolding (`cursor/`) |
| `research/` | Estudos e análises internas |
| `examples/` | Exemplos de uso |
| `plugins/` | Plugins ECC |
| `assets/` | Imagens e assets de documentação |
| `ecc2/` | ECC 2.0 alpha (Rust) — `Cargo.toml`, `src/` |
| `src/llm/` | Provider Python (`cli/`, `core/`, `prompt/`, `providers/`, `tools/`) |
| `legacy-command-shims/` | Shims de compatibilidade com comandos legados |
| `.github/` | CI/CD (`workflows/`), templates de PR/issue, Copilot instructions, prompts |
