# Build e Correção

Corrija erros de build e de tipos incrementalmente com mudanças mínimas e seguras.

## Passo 1: Detectar Sistema de Build

Identifique a ferramenta de build do projeto e execute o build:

| Indicator | Build Command |
|-----------|---------------|
| `package.json` with `build` script | `npm run build` or `pnpm build` |
| `tsconfig.json` (TypeScript only) | `npx tsc --noEmit` |
| `Cargo.toml` | `cargo build 2>&1` |
| `pom.xml` | `mvn compile` |
| `build.gradle` | `./gradlew compileJava` |
| `go.mod` | `go build ./...` |
| `pyproject.toml` | `python -m py_compile` or `mypy .` |

## Passo 2: Parsear e Agrupar Erros

1. Execute o comando de build e capture o stderr
2. Agrupe erros por caminho de arquivo
3. Ordene por ordem de dependência (corrija imports/tipos antes de erros de lógica)
4. Conte o total de erros para acompanhamento de progresso

## Passo 3: Loop de Correção (Um Erro por Vez)

Para cada erro:

1. **Leia o arquivo** — Use a ferramenta Read para ver o contexto do erro (10 linhas ao redor do erro)
2. **Diagnostique** — Identifique a causa raiz (import ausente, tipo errado, erro de sintaxe)
3. **Corrija minimamente** — Use a ferramenta Edit para a menor mudança que resolve o erro
4. **Rode o build novamente** — Verifique que o erro sumiu e que nenhum novo erro foi introduzido
5. **Vá para o próximo** — Continue com os erros restantes

## Passo 4: Guardrails

Pare e pergunte ao usuário se:
- Uma correção introduz **mais erros do que resolve**
- O **mesmo erro persiste após 3 tentativas** (provavelmente há um problema mais profundo)
- A correção exige **mudanças arquiteturais** (não apenas correção de build)
- Os erros de build vêm de **dependências ausentes** (precisa de `npm install`, `cargo add`, etc.)

## Passo 5: Resumo

Mostre resultados:
- Erros corrigidos (com caminhos de arquivos)
- Erros restantes (se houver)
- Novos erros introduzidos (deve ser zero)
- Próximos passos sugeridos para problemas não resolvidos

## Estratégias de Recuperação

| Situation | Action |
|-----------|--------|
| Missing module/import | Check if package is installed; suggest install command |
| Type mismatch | Read both type definitions; fix the narrower type |
| Circular dependency | Identify cycle with import graph; suggest extraction |
| Version conflict | Check `package.json` / `Cargo.toml` for version constraints |
| Build tool misconfiguration | Read config file; compare with working defaults |

Corrija um erro por vez por segurança. Prefira diffs mínimos em vez de refatoração.
