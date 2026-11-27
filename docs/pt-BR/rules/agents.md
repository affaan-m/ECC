# Orquestração de Agentes

## Agentes Disponíveis

Localizados em `~/.claude/agents/`:

| Agente | Propósito | Quando Usar |
|--------|-----------|-------------|
| planner | Planejamento de implementação | Recursos complexos, refatoração |
| architect | Design de sistema | Decisões arquiteturais |
| tdd-guide | Desenvolvimento orientado a testes | Novos recursos, correção de bugs |
| code-reviewer | Revisão de código | Após escrever código |
| security-reviewer | Análise de segurança | Antes de commits |
| build-error-resolver | Corrigir erros de build | Quando o build falha |
| e2e-runner | Testes E2E | Fluxos críticos do usuário |
| refactor-cleaner | Limpeza de código morto | Manutenção de código |
| doc-updater | Documentação | Atualização de docs |
| rust-reviewer | Revisão de código Rust | Projetos Rust |

## Uso Imediato de Agentes

Sem necessidade de prompt do usuário:
1. Solicitações de recursos complexos - Use o agente **planner**
2. Código acabado de escrever/modificar - Use o agente **code-reviewer**
3. Correção de bug ou novo recurso - Use o agente **tdd-guide**
4. Decisão arquitetural - Use o agente **architect**

## Execução Paralela de Tarefas

SEMPRE use execução paralela de Task para operações independentes:

```markdown
# BOM: Execução paralela
Iniciar 3 agentes em paralelo:
1. Agente 1: Análise de segurança do módulo de autenticação
2. Agente 2: Revisão de desempenho do sistema de cache
3. Agente 3: Verificação de tipos dos utilitários

# RUIM: Sequencial quando desnecessário
Primeiro agente 1, depois agente 2, depois agente 3
```

## Análise Multi-Perspectiva

Para problemas complexos, use subagentes com papéis divididos:
- Revisor factual
- Engenheiro sênior
- Especialista em segurança
- Revisor de consistência
- Verificador de redundância
