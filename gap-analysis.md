# Gap Analysis — Harness PM/PD/UX (v2) × Fork ECC

> **Documento parcial e datado.** Gerado em 2026-06-24 a partir de **dois insumos apenas**:
> (1) este fork ECC, no estado lido nesta sessão; (2) os drafts `briefing-para-claude-code.md`
> e `harness-pm-pd-ux-v2.md`. **NÃO É UMA ANÁLISE COMPLETA.**

---

## ⚠️ Aviso de completude (ler antes de usar)

1. **O repositório de referência do autor é mais completo do que o descrito nos `.md`.**
   Os drafts anexados foram implementados em outra conta e mencionam recursos
   (memória de decisões DDD/SDD, pipeline de atualização Confluence/Jira, etc.) que
   **podem já existir, em versão diferente ou mais avançada, na repo mais atualizada**.
   Este gap-analysis foi montado contra o *snapshot* do fork ECC visível nesta sessão,
   que pode estar **defasado** em relação a essa repo.

2. **Pré-condição de aceite.** Este arquivo só pode ser tratado como completo **depois**
   de o modelo executar a checklist de re-análise da seção 5 contra a versão mais
   atualizada do repositório. Até lá, todas as linhas marcadas `[CHECAR]` e `[FALTA]`
   são provisórias.

3. **Marcas NEXUS.** `[FONTE-REPO]` = verificado por leitura de arquivo neste fork (caminho citado) ·
   `[FONTE]` = citação do modelo v2 · `[INFERIDO]` = derivado, premissa explícita ·
   `[HIPÓTESE]` = sem base verificável · `[CHECAR]` = não verificado nesta sessão ·
   `[FALTA]` = variável necessária ausente.

---

## 1. Gap analysis — Componentes do harness × Fork ECC

| Componente (v2) | Status no fork ECC | Alinhado ao v2? | Gap / O que falta | Ação recomendada |
|---|---|---|---|---|
| **1. Instruções / Rule Files** | **Sim.** `CLAUDE.md`, `SOUL.md`, `RULES.md`, `rules/` (23 linguagens), `skills/rules-distill`, `hookify` `[FONTE-REPO]` | Sim, e excede: o v2 só descreve o artefato; o ECC operacionaliza regra→hook | Coluna PM ("princípios inegociáveis") não está formalizada como artefato separado da config técnica | Derivar bloco "princípios inegociáveis do produto" no `CLAUDE.md` a partir da coluna PM |
| **2. Tools & MCP** | **Sim.** `skills/agent-harness-construction` (action space, schema-first, least-privilege), `mcp-server-patterns`, `api-connector-builder` `[FONTE-REPO]` | Sim. *Action receipt* `[FONTE][4]` mapeado em `status/summary/next_actions/artifacts` | *Idempotency keys* citadas como conceito, não como artefato verificado no fork | Confirmar `[CHECAR]` se há padrão de idempotência explícito nas skills MCP |
| **3. Orquestração** | **Sim.** `skills/orch-*`, `commands/multi-*`, `team-agent-orchestration`, `loop-operator` `[FONTE-REPO]` | Sim. "who has the ball / handoff" `[FONTE][26]` presente nos contratos `orch-*` | Visualização do controle atual (UX) é implícita, não um artefato de 1ª classe | Avaliar artefato de handoff visível derivado da coluna PD/UX |
| **4. Guardrails & Hooks** | **Sim.** `skills/safety-guard`, `gateguard`, `hooks/` (PreToolUse), `security-review`, `the-security-guide.md` `[FONTE-REPO]` | Parcial. Bloqueio: forte. UX do bloqueio: fraca | **Gap real:** estados de erro que expliquem motivo + recuperação + preservem agência `[FONTE][19]` não são recurso dedicado | Herdar padrão de error-state/recovery (candidato vindo do outro projeto) |
| **5. Memória / Sessão** | **Sim.** `hooks/memory-persistence`, `skills/knowledge-ops`, `save/resume-session`, `checkpoint`, `continuous-learning-v2` `[FONTE-REPO]` | Sim, e excede com instintos por escopo de projeto | UX "o que lembro / por quê / editar / apagar" `[FONTE][4]` parcial | Mapear a superfície de consentimento/edição de memória |
| **6. Avaliação / Teste** | **Sim.** `skills/eval-harness` (EDD, pass@k, golden dataset), `agent-eval`, `agent-self-evaluation`, `commands/learn-eval`, `agents/agent-evaluator` `[FONTE-REPO]` | Parcial — núcleo PM coberto; rubricas de UX não | **`[FALTA]` 01 (prioridade máx.):** rubricas qualitativas de UX (incerteza / carga cognitiva / clareza de handoff) no pipeline. `agent-self-evaluation` cobre 5 eixos genéricos, não os 3 de UX | Estender `agent-self-evaluation` com os 3 critérios de UX → promover `[FALTA]`→`[INFERIDO]` com premissa |
| **7. Observabilidade** | **Sim.** `skills/cost-tracking`, `hook stop:cost-tracker`, `commands/cost-report`, `ecc_dashboard.py`, `dashboard-builder` `[FONTE-REPO]` | Parcial. Custo/trace: sim. Timeline UX: parcial | "Linha do tempo de atividades colapsável" `[FONTE][4][25]` existe como dashboard, não como artefato UX legível | Desenhar timeline colapsável com severidade + passo atual |
| **8. Deployment / Service / HITL** | **Sim.** `skills/deployment-patterns`, `commands/quality-gate`/`promote`/`epic-*`/`pr` `[FONTE-REPO]` | Sim | Métricas `escalation/approval rate` permanecem `[HIPÓTESE]` (sem fonte no fork) | Manter `[HIPÓTESE]` até medir na repo atual |

---

## 2. Linhas candidatas a NOVO pilar (pendências 04/05 do briefing)

| Pilar candidato | Recursos no fork ECC | Veredito |
|---|---|---|
| **DDD / bounded context** (pend. 04) | `skills/hexagonal-architecture`, `architecture-decision-records`, `agent-architecture-audit` (12-layer) `[FONTE-REPO]` | **Promover a linha própria.** Base existe para modelar o particionamento da base federada |
| **Docs-para-agentes** (pend. 05) | `skills/knowledge-ops`, `documentation-lookup`, `update-docs`/`update-codemaps`, `doc-updater`, `rules-distill` `[FONTE-REPO]` | **Promover a linha própria.** É o núcleo do produto; curadoria contínua + KB versionada já presentes |
| **Memória de decisões** (novo, do outro projeto) | `skills/recursive-decision-ledger` (ledger JSONL append-only, marks accept/watch/reject, promotion gate), `architecture-decision-records` `[FONTE-REPO]` | **Incorporar.** Operacionaliza o "log de decisões" da §2 da v2 — nenhum draft tem isso implementado |

---

## 3. Comparação com o projeto de terceiro (outra conta / drafts)

> **Limitação:** o "projeto de terceiro" só é conhecido através dos dois `.md`. Recursos
> mencionados de passagem (Confluence pipeline, memória DDD/SDD) **não têm artefato
> inspecionável nesta sessão** → marcados `[CHECAR]`/`[FALTA]`.

| Componente | Nossa posição (v2/ECC) | Abordagem do terceiro | Conv./Diverg. | Incorporar? |
|---|---|---|---|---|
| Avaliação/UX rubrics | `agent-self-evaluation` (5 eixos) | Rubricas qualitativas de UX no pipeline `[FALTA]` corpus | **Convergente em forma, divergente em conteúdo** | Sim, se o terceiro tiver as rubricas com citação |
| Memória de decisões | `recursive-decision-ledger` + ADR | DDD/SDD decision memory `[CHECAR]` | Provável convergência | Reconciliar quando a repo atual for lida |
| Pipeline Jira | `skills/jira-integration` + `commands/jira` (MCP atlassian) `[FONTE-REPO]` | Jira pipeline `[CHECAR]` | Convergente | Já coberto |
| Pipeline Confluence | **Ausente** no fork `[FONTE-REPO]` | Confluence pipeline `[CHECAR]` | **Divergente (gap do ECC)** | Sim — estender padrão MCP atlassian |
| Estados de erro (UX) | Bloqueio forte, UX fraca | `[FONTE][19]` Design for AI Error States | Divergente | Sim |

---

## 4. Pendências do briefing — status nesta análise parcial

| Pendência | Status | Observação |
|---|---|---|
| 01 — `[FALTA]` rubricas UX no eval | **Parcialmente desbloqueada** | `agent-self-evaluation` é a base mais próxima; falta estender p/ 3 critérios de UX |
| 02 — `[CHECAR]` métricas numéricas | **Não resolvida** | Sem fonte no fork; manter `[HIPÓTESE]` |
| 03 — `[CHECAR]` fonte [5] | **Não resolvida** | Não localizada neste fork |
| 04 — DDD como linha própria | **Desbloqueada** | Base arquitetural presente |
| 05 — docs-para-agentes como linha | **Desbloqueada** | Núcleo do produto presente |

---

## 5. Checklist de re-análise OBRIGATÓRIA antes de aceitar como completo

Executar contra a **repo mais atualizada do autor** (não apenas este fork):

```
[ ] 1. Listar agents/ skills/ commands/ hooks/ rules/ da repo ATUAL e comparar
       com o inventário desta sessão — registrar deltas.
[ ] 2. Procurar recursos que os .md mencionam mas não detalham:
       - memória de decisões DDD/SDD  -> existe? em que forma?
       - pipeline Confluence          -> confirmar ausência/presença
       - pipeline Jira                -> confirmar paridade
[ ] 3. Reavaliar cada [CHECAR] e [FALTA] deste documento contra a repo atual.
[ ] 4. Reconciliar métricas [HIPÓTESE] (escalation/approval/semantic similarity)
       com qualquer dado real medido na repo atual.
[ ] 5. Confirmar se os pilares candidatos (DDD, docs-para-agentes) JÁ são linhas
       formais na repo atual antes de propô-los como "novos".
[ ] 6. Só então remover este aviso e marcar o documento como completo.
```

**Enquanto a seção 5 não for executada, este documento é um rascunho de trabalho, não um gap-analysis final.**
