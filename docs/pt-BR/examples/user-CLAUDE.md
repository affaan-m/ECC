# Exemplo de CLAUDE.md no Nível de Usuário

Este é um exemplo de arquivo CLAUDE.md no nível de usuário. Coloque em `~/.claude/CLAUDE.md`.

Configurações de nível de usuário se aplicam globalmente em todos os projetos. Use para:
- Preferências pessoais de código
- Regras universais que você sempre quer aplicar
- Links para suas regras modulares

---

## Filosofia Central

Você é Claude Code. Eu uso agentes e skills especializados para tarefas complexas.

**Princípios-Chave:**
1. **Agent-First**: Delegue trabalho complexo para agentes especializados
2. **Execução Paralela**: Use ferramenta Task com múltiplos agentes quando possível
3. **Planejar Antes de Executar**: Use Plan Mode para operações complexas
4. **Test-Driven**: Escreva testes antes da implementação
5. **Security-First**: Nunca comprometa segurança

---

## Regras Modulares

Diretrizes detalhadas em `~/.claude/rules/`:

| Rule File | Contents |
|-----------|----------|
| security.md | Security checks, secret management |
| coding-style.md | Immutability, file organization, error handling |
| testing.md | TDD workflow, 80% coverage requirement |
| git-workflow.md | Commit format, PR workflow |
| agents.md | Agent orchestration, when to use which agent |
| patterns.md | API response, repository patterns |
| performance.md | Model selection, context management |
| hooks.md | Hooks System |

---

## Agentes Disponíveis

Localizados em `~/.claude/agents/`:

| Agent | Purpose |
|-------|---------|
| planner | Feature implementation planning |
| architect | System design and architecture |
| tdd-guide | Test-driven development |
| code-reviewer | Code review for quality/security |
| security-reviewer | Security vulnerability analysis |
| build-error-resolver | Build error resolution |
| e2e-runner | Playwright E2E testing |
| refactor-cleaner | Dead code cleanup |
| doc-updater | Documentation updates |

---

## Preferências Pessoais

### Privacidade
- Sempre anonimizar logs; nunca colar segredos (API keys/tokens/passwords/JWTs)
- Revise a saída antes de compartilhar - remova qualquer dado sensível

### Estilo de Código
- Sem emojis em código, comentários ou documentação
- Prefira imutabilidade - nunca mutar objetos ou arrays
- Muitos arquivos pequenos em vez de poucos arquivos grandes
- 200-400 linhas típico, 800 máximo por arquivo

### Git
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- Sempre testar localmente antes de commitar
- Commits pequenos e focados

### Testes
- TDD: escreva testes primeiro
- Cobertura mínima de 80%
- Unit + integration + E2E para fluxos críticos

### Captura de Conhecimento
- Notas pessoais de debug, preferências e contexto temporário → auto memory
- Conhecimento de time/projeto (decisões de arquitetura, mudanças de API, runbooks de implementação) → seguir estrutura de docs já existente no projeto
- Se a tarefa atual já produzir docs/comentários/exemplos relevantes, não duplique o mesmo conhecimento em outro lugar
- Se não houver local óbvio de docs no projeto, pergunte antes de criar um novo doc de topo

---

## Integração com Editor

Eu uso Zed como editor principal:
- Agent Panel para rastreamento de arquivos
- CMD+Shift+R para command palette
- Vim mode habilitado

---

## Métricas de Sucesso

Você tem sucesso quando:
- Todos os testes passam (80%+ de cobertura)
- Não há vulnerabilidades de segurança
- O código é legível e manutenível
- Os requisitos do usuário são atendidos

---

**Filosofia**: Design agent-first, execução paralela, planejar antes de agir, testar antes de codar, segurança sempre.
