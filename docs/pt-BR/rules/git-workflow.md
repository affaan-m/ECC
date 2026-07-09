# Fluxo de Trabalho Git

## Formato de Mensagem de Commit
```
<tipo>: <descrição>

<corpo opcional>
```

Tipos: feat, fix, refactor, docs, test, chore, perf, ci

Nota: Para desativar a atribuição de coautoria, defina `"includeCoAuthoredBy": false` em `~/.claude/settings.json`; o Claude Code adiciona `Co-Authored-By` por padrão e o ECC não inclui essa configuração.

## Fluxo de Trabalho de Pull Request

Ao criar PRs:
1. Analisar o histórico completo de commits (não apenas o último commit)
2. Usar `git diff [branch-base]...HEAD` para ver todas as alterações
3. Rascunhar resumo abrangente do PR
4. Incluir plano de teste com TODOs
5. Fazer push com a flag `-u` se for uma nova branch

> Para o processo de desenvolvimento completo (planejamento, TDD, revisão de código) antes de operações git,
> veja [development-workflow.md](./development-workflow.md).
