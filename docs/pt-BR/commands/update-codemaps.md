# Atualizar Codemaps

Analise a estrutura do codebase e gere documentação arquitetural enxuta em tokens.

## Passo 1: Escanear Estrutura do Projeto

1. Identifique o tipo de projeto (monorepo, app única, library, microservice)
2. Encontre todos os diretórios de código-fonte (src/, lib/, app/, packages/)
3. Mapeie entry points (main.ts, index.ts, app.py, main.go, etc.)

## Passo 2: Gerar Codemaps

Crie ou atualize codemaps em `docs/CODEMAPS/` (ou `.reports/codemaps/`):

| File | Contents |
|------|----------|
| `architecture.md` | High-level system diagram, service boundaries, data flow |
| `backend.md` | API routes, middleware chain, service → repository mapping |
| `frontend.md` | Page tree, component hierarchy, state management flow |
| `data.md` | Database tables, relationships, migration history |
| `dependencies.md` | External services, third-party integrations, shared libraries |

### Formato de Codemap

Cada codemap deve ser enxuto em tokens — otimizado para consumo de contexto por IA:

```markdown
# Backend Architecture

## Routes
POST /api/users → UserController.create → UserService.create → UserRepo.insert
GET  /api/users/:id → UserController.get → UserService.findById → UserRepo.findById

## Key Files
src/services/user.ts (business logic, 120 lines)
src/repos/user.ts (database access, 80 lines)

## Dependencies
- PostgreSQL (primary data store)
- Redis (session cache, rate limiting)
- Stripe (payment processing)
```

## Passo 3: Detecção de Diff

1. Se codemaps anteriores existirem, calcule a porcentagem de diff
2. Se mudanças > 30%, mostre o diff e solicite aprovação do usuário antes de sobrescrever
3. Se mudanças <= 30%, atualize in-place

## Passo 4: Adicionar Metadados

Adicione um cabeçalho de freshness em cada codemap:

```markdown
<!-- Generated: 2026-02-11 | Files scanned: 142 | Token estimate: ~800 -->
```

## Passo 5: Salvar Relatório de Análise

Escreva um resumo em `.reports/codemap-diff.txt`:
- Arquivos adicionados/removidos/modificados desde o último scan
- Novas dependências detectadas
- Mudanças de arquitetura (novas rotas, novos serviços etc.)
- Alertas de obsolescência para docs sem atualização em 90+ dias

## Dicas

- Foque em **estrutura de alto nível**, não em detalhes de implementação
- Prefira **caminhos de arquivo e assinaturas de função** em vez de blocos de código completos
- Mantenha cada codemap abaixo de **1000 tokens** para carregamento eficiente de contexto
- Use diagramas ASCII para fluxo de dados em vez de descrições verbosas
- Rode após grandes adições de feature ou sessões de refatoração
