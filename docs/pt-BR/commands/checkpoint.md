# Comando Checkpoint

Crie ou verifique um checkpoint no seu fluxo.

## Uso

`/checkpoint [create|verify|list] [name]`

## Criar Checkpoint

Ao criar um checkpoint:

1. Rode `/verify quick` para garantir que o estado atual está limpo
2. Crie um git stash ou commit com o nome do checkpoint
3. Registre o checkpoint em `.claude/checkpoints.log`:

```bash
echo "$(date +%Y-%m-%d-%H:%M) | $CHECKPOINT_NAME | $(git rev-parse --short HEAD)" >> .claude/checkpoints.log
```

4. Informe que o checkpoint foi criado

## Verificar Checkpoint

Ao verificar contra um checkpoint:

1. Leia o checkpoint no log
2. Compare o estado atual com o checkpoint:
   - Arquivos adicionados desde o checkpoint
   - Arquivos modificados desde o checkpoint
   - Taxa de testes passando agora vs antes
   - Cobertura agora vs antes

3. Reporte:
```
CHECKPOINT COMPARISON: $NAME
============================
Files changed: X
Tests: +Y passed / -Z failed
Coverage: +X% / -Y%
Build: [PASS/FAIL]
```

## Listar Checkpoints

Mostre todos os checkpoints com:
- Nome
- Timestamp
- Git SHA
- Status (current, behind, ahead)

## Fluxo

Fluxo típico de checkpoint:

```
[Start] --> /checkpoint create "feature-start"
   |
[Implement] --> /checkpoint create "core-done"
   |
[Test] --> /checkpoint verify "core-done"
   |
[Refactor] --> /checkpoint create "refactor-done"
   |
[PR] --> /checkpoint verify "feature-start"
```

## Argumentos

$ARGUMENTS:
- `create <name>` - Criar checkpoint nomeado
- `verify <name>` - Verificar contra checkpoint nomeado
- `list` - Mostrar todos os checkpoints
- `clear` - Remover checkpoints antigos (mantém os últimos 5)
