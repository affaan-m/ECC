# Cobertura de Testes

Analise cobertura de testes, identifique lacunas e gere testes faltantes para alcançar cobertura de 80%+.

## Passo 1: Detectar Framework de Teste

| Indicator | Coverage Command |
|-----------|-----------------|
| `jest.config.*` or `package.json` jest | `npx jest --coverage --coverageReporters=json-summary` |
| `vitest.config.*` | `npx vitest run --coverage` |
| `pytest.ini` / `pyproject.toml` pytest | `pytest --cov=src --cov-report=json` |
| `Cargo.toml` | `cargo llvm-cov --json` |
| `pom.xml` with JaCoCo | `mvn test jacoco:report` |
| `go.mod` | `go test -coverprofile=coverage.out ./...` |

## Passo 2: Analisar Relatório de Cobertura

1. Rode o comando de cobertura
2. Parseie a saída (resumo em JSON ou saída de terminal)
3. Liste arquivos **abaixo de 80% de cobertura**, ordenados do pior para o melhor
4. Para cada arquivo abaixo da meta, identifique:
   - Funções ou métodos sem teste
   - Cobertura de branch faltante (if/else, switch, caminhos de erro)
   - Código morto que infla o denominador

## Passo 3: Gerar Testes Faltantes

Para cada arquivo abaixo da meta, gere testes seguindo esta prioridade:

1. **Happy path** — Funcionalidade principal com entradas válidas
2. **Tratamento de erro** — Entradas inválidas, dados ausentes, falhas de rede
3. **Casos de borda** — Arrays vazios, null/undefined, valores de fronteira (0, -1, MAX_INT)
4. **Cobertura de branch** — Cada if/else, caso de switch, ternário

### Regras para Geração de Testes

- Coloque testes adjacentes ao código-fonte: `foo.ts` → `foo.test.ts` (ou convenção do projeto)
- Use padrões de teste existentes do projeto (estilo de import, biblioteca de asserção, abordagem de mocking)
- Faça mock de dependências externas (banco, APIs, sistema de arquivos)
- Cada teste deve ser independente — sem estado mutável compartilhado entre testes
- Nomeie testes de forma descritiva: `test_create_user_with_duplicate_email_returns_409`

## Passo 4: Verificar

1. Rode a suíte completa de testes — todos os testes devem passar
2. Rode cobertura novamente — confirme a melhoria
3. Se ainda estiver abaixo de 80%, repita o Passo 3 para as lacunas restantes

## Passo 5: Reportar

Mostre comparação antes/depois:

```
Coverage Report
──────────────────────────────
File                   Before  After
src/services/auth.ts   45%     88%
src/utils/validation.ts 32%    82%
──────────────────────────────
Overall:               67%     84%  PASS:
```

## Áreas de Foco

- Funções com branching complexo (alta complexidade ciclomática)
- Error handlers e blocos catch
- Funções utilitárias usadas em todo o codebase
- Handlers de endpoint de API (fluxo request → response)
- Casos de borda: null, undefined, string vazia, array vazio, zero, números negativos
