---
description: Orientação de orquestração sequencial e tmux/worktree para fluxos multiagente.
---

# Comando Orchestrate

Fluxo sequencial de agentes para tarefas complexas.

## Uso

`/orchestrate [workflow-type] [task-description]`

## Tipos de Workflow

### feature
Workflow completo de implementação de feature:
```
planner -> tdd-guide -> code-reviewer -> security-reviewer
```

### bugfix
Workflow de investigação e correção de bug:
```
planner -> tdd-guide -> code-reviewer
```

### refactor
Workflow de refatoração segura:
```
architect -> code-reviewer -> tdd-guide
```

### security
Revisão focada em segurança:
```
security-reviewer -> code-reviewer -> architect
```

## Padrão de Execução

Para cada agente no workflow:

1. **Invoque o agente** com contexto do agente anterior
2. **Colete saída** como documento estruturado de handoff
3. **Passe para o próximo agente** na cadeia
4. **Agregue resultados** em um relatório final

## Formato do Documento de Handoff

Entre agentes, crie um documento de handoff:

```markdown
## HANDOFF: [previous-agent] -> [next-agent]

### Context
[Summary of what was done]

### Findings
[Key discoveries or decisions]

### Files Modified
[List of files touched]

### Open Questions
[Unresolved items for next agent]

### Recommendations
[Suggested next steps]
```

## Exemplo: Workflow de Feature

```
/orchestrate feature "Add user authentication"
```

Executa:

1. **Planner Agent**
   - Analisa requisitos
   - Cria plano de implementação
   - Identifica dependências
   - Saída: `HANDOFF: planner -> tdd-guide`

2. **TDD Guide Agent**
   - Lê handoff do planner
   - Escreve testes primeiro
   - Implementa para passar testes
   - Saída: `HANDOFF: tdd-guide -> code-reviewer`

3. **Code Reviewer Agent**
   - Revisa implementação
   - Verifica problemas
   - Sugere melhorias
   - Saída: `HANDOFF: code-reviewer -> security-reviewer`

4. **Security Reviewer Agent**
   - Auditoria de segurança
   - Verificação de vulnerabilidades
   - Aprovação final
   - Saída: Relatório Final

## Formato do Relatório Final

```
ORCHESTRATION REPORT
====================
Workflow: feature
Task: Add user authentication
Agents: planner -> tdd-guide -> code-reviewer -> security-reviewer

SUMMARY
-------
[One paragraph summary]

AGENT OUTPUTS
-------------
Planner: [summary]
TDD Guide: [summary]
Code Reviewer: [summary]
Security Reviewer: [summary]

FILES CHANGED
-------------
[List all files modified]

TEST RESULTS
------------
[Test pass/fail summary]

SECURITY STATUS
---------------
[Security findings]

RECOMMENDATION
--------------
[SHIP / NEEDS WORK / BLOCKED]
```

## Execução Paralela

Para verificações independentes, rode agentes em paralelo:

```markdown
### Fase Paralela
Executar simultaneamente:
- code-reviewer (qualidade)
- security-reviewer (segurança)
- architect (design)

### Mesclar Resultados
Combinar saídas em um único relatório

Para workers externos em tmux panes com git worktrees separados, use `node scripts/orchestrate-worktrees.js plan.json --execute`. O padrão embutido de orquestração permanece no processo atual; o helper é para sessões longas ou cross-harness.

Quando os workers precisarem enxergar arquivos locais sujos ou não rastreados do checkout principal, adicione `seedPaths` ao arquivo de plano. O ECC faz overlay apenas desses caminhos selecionados em cada worktree do worker após `git worktree add`, mantendo o branch isolado e ainda expondo scripts, planos ou docs em andamento.

```json
{
  "sessionName": "workflow-e2e",
  "seedPaths": [
    "scripts/orchestrate-worktrees.js",
    "scripts/lib/tmux-worktree-orchestrator.js",
    ".claude/plan/workflow-e2e-test.json"
  ],
  "workers": [
    { "name": "docs", "task": "Update orchestration docs." }
  ]
}
```

Para exportar um snapshot do control plane para uma sessão tmux/worktree ao vivo, rode:

```bash
node scripts/orchestration-status.js .claude/plan/workflow-visual-proof.json
```

O snapshot inclui atividade da sessão, metadados de pane do tmux, estado dos workers, objetivos, overlays semeados e resumos recentes de handoff em formato JSON.

## Handoff de Command Center do Operador

Quando o workflow atravessar múltiplas sessões, worktrees ou panes tmux, acrescente um bloco de control plane ao handoff final:

```markdown
CONTROL PLANE
-------------
Sessions:
- active session ID or alias
- branch + worktree path for each active worker
- tmux pane or detached session name when applicable

Diffs:
- git status summary
- git diff --stat for touched files
- merge/conflict risk notes

Approvals:
- pending user approvals
- blocked steps awaiting confirmation

Telemetry:
- last activity timestamp or idle signal
- estimated token or cost drift
- policy events raised by hooks or reviewers
```

Isso mantém planner, implementador, revisor e loop workers legíveis pela superfície de operação.

## Argumentos

$ARGUMENTS:
- `feature <description>` - Workflow completo de feature
- `bugfix <description>` - Workflow de correção de bug
- `refactor <description>` - Workflow de refatoração
- `security <description>` - Workflow de revisão de segurança
- `custom <agents> <description>` - Sequência customizada de agentes

## Exemplo de Workflow Customizado

```
/orchestrate custom "architect,tdd-guide,code-reviewer" "Redesign caching layer"
```

## Dicas

1. **Comece com planner** para features complexas
2. **Sempre inclua code-reviewer** antes do merge
3. **Use security-reviewer** para auth/pagamento/PII
4. **Mantenha handoffs concisos** - foque no que o próximo agente precisa
5. **Rode verificação** entre agentes quando necessário
