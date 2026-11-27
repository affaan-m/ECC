# Refactor Clean

Identifique e remova código morto com segurança, com verificação de testes em cada passo.

## Passo 1: Detectar Código Morto

Rode ferramentas de análise com base no tipo do projeto:

| Tool | What It Finds | Command |
|------|--------------|---------|
| knip | Unused exports, files, dependencies | `npx knip` |
| depcheck | Unused npm dependencies | `npx depcheck` |
| ts-prune | Unused TypeScript exports | `npx ts-prune` |
| vulture | Unused Python code | `vulture src/` |
| deadcode | Unused Go code | `deadcode ./...` |
| cargo-udeps | Unused Rust dependencies | `cargo +nightly udeps` |

Se nenhuma ferramenta estiver disponível, use Grep para encontrar exports com zero imports:
```
# Find exports, then check if they're imported anywhere
```

## Passo 2: Categorizar Achados

Classifique os achados em níveis de segurança:

| Tier | Examples | Action |
|------|----------|--------|
| **SAFE** | Unused utilities, test helpers, internal functions | Delete with confidence |
| **CAUTION** | Components, API routes, middleware | Verify no dynamic imports or external consumers |
| **DANGER** | Config files, entry points, type definitions | Investigate before touching |

## Passo 3: Loop de Remoção Segura

Para cada item SAFE:

1. **Rode a suíte completa de testes** — Estabeleça baseline (tudo verde)
2. **Delete o código morto** — Use a ferramenta Edit para remoção cirúrgica
3. **Rode a suíte de testes novamente** — Verifique se nada quebrou
4. **Se testes falharem** — Reverta imediatamente com `git checkout -- <file>` e pule este item
5. **Se testes passarem** — Vá para o próximo item

## Passo 4: Tratar Itens CAUTION

Antes de deletar itens CAUTION:
- Procure imports dinâmicos: `import()`, `require()`, `__import__`
- Procure referências em string: nomes de rota, nomes de componente em configs
- Verifique se é exportado por API pública de pacote
- Verifique ausência de consumidores externos (dependents, se publicado)

## Passo 5: Consolidar Duplicatas

Depois de remover código morto, procure:
- Funções quase duplicadas (>80% similares) — mesclar em uma
- Definições de tipo redundantes — consolidar
- Funções wrapper sem valor — inline
- Re-exports sem propósito — remover indireção

## Passo 6: Resumo

Reporte resultados:

```
Dead Code Cleanup
──────────────────────────────
Deleted:   12 unused functions
           3 unused files
           5 unused dependencies
Skipped:   2 items (tests failed)
Saved:     ~450 lines removed
──────────────────────────────
All tests passing PASS:
```

## Regras

- **Nunca delete sem rodar testes antes**
- **Uma remoção por vez** — Mudanças atômicas facilitam rollback
- **Se houver dúvida, pule** — Melhor manter código morto do que quebrar produção
- **Não refatore durante limpeza** — Separe responsabilidades (limpar primeiro, refatorar depois)
