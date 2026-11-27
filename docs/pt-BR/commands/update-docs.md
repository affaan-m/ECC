# Atualizar Documentação

Sincronize a documentação com o codebase, gerando a partir de arquivos fonte da verdade.

## Passo 1: Identificar Fontes da Verdade

| Source | Generates |
|--------|-----------|
| `package.json` scripts | Available commands reference |
| `.env.example` | Environment variable documentation |
| `openapi.yaml` / route files | API endpoint reference |
| Source code exports | Public API documentation |
| `Dockerfile` / `docker-compose.yml` | Infrastructure setup docs |

## Passo 2: Gerar Referência de Scripts

1. Leia `package.json` (ou `Makefile`, `Cargo.toml`, `pyproject.toml`)
2. Extraia todos os scripts/comandos com suas descrições
3. Gere uma tabela de referência:

```markdown
| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Production build with type checking |
| `npm test` | Run test suite with coverage |
```

## Passo 3: Gerar Documentação de Ambiente

1. Leia `.env.example` (ou `.env.template`, `.env.sample`)
2. Extraia todas as variáveis e seus propósitos
3. Categorize como required vs optional
4. Documente formato esperado e valores válidos

```markdown
| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgres://user:pass@host:5432/db` |
| `LOG_LEVEL` | No | Logging verbosity (default: info) | `debug`, `info`, `warn`, `error` |
```

## Passo 4: Atualizar Guia de Contribuição

Gere ou atualize `docs/CONTRIBUTING.md` com:
- Setup do ambiente de desenvolvimento (pré-requisitos, passos de instalação)
- Scripts disponíveis e seus propósitos
- Procedimentos de teste (como rodar, como escrever novos testes)
- Enforcement de estilo de código (linter, formatter, hooks pre-commit)
- Checklist de submissão de PR

## Passo 5: Atualizar Runbook

Gere ou atualize `docs/RUNBOOK.md` com:
- Procedimentos de deploy (passo a passo)
- Endpoints de health check e monitoramento
- Problemas comuns e suas correções
- Procedimentos de rollback
- Caminhos de alerta e escalonamento

## Passo 6: Checagem de Obsolescência

1. Encontre arquivos de documentação sem modificação há 90+ dias
2. Cruze com mudanças recentes no código-fonte
3. Sinalize docs potencialmente desatualizadas para revisão manual

## Passo 7: Mostrar Resumo

```
Documentation Update
──────────────────────────────
Updated:  docs/CONTRIBUTING.md (scripts table)
Updated:  docs/ENV.md (3 new variables)
Flagged:  docs/DEPLOY.md (142 days stale)
Skipped:  docs/API.md (no changes detected)
──────────────────────────────
```

## Regras

- **Fonte única da verdade**: Sempre gere a partir do código, nunca edite manualmente seções geradas
- **Preserve seções manuais**: Atualize apenas seções geradas; mantenha prosa escrita manualmente intacta
- **Marque conteúdo gerado**: Use marcadores `<!-- AUTO-GENERATED -->` ao redor das seções geradas
- **Não crie docs sem solicitação**: Só crie novos arquivos de docs se o comando solicitar explicitamente
