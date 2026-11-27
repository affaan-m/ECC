---
description: Crear, verificar o listar puntos de control del flujo de trabajo después de ejecutar verificaciones.
---

# Comando Checkpoint

Crear o verificar un punto de control en tu flujo de trabajo.

## Uso

`/checkpoint [create|verify|list] [nombre]`

## Crear Checkpoint

Al crear un checkpoint:

1. Ejecutar `/verify quick` para asegurarse de que el estado actual está limpio
2. Crear un git stash o commit con el nombre del checkpoint
3. Registrar el checkpoint en `.claude/checkpoints.log`:

```bash
echo "$(date +%Y-%m-%d-%H:%M) | $CHECKPOINT_NAME | $(git rev-parse --short HEAD)" >> .claude/checkpoints.log
```

4. Reportar que el checkpoint fue creado

## Verificar Checkpoint

Al verificar contra un checkpoint:

1. Leer el checkpoint desde el log
2. Comparar el estado actual con el checkpoint:
   - Archivos añadidos desde el checkpoint
   - Archivos modificados desde el checkpoint
   - Tasa de pruebas pasadas ahora vs entonces
   - Cobertura ahora vs entonces

3. Reportar:
```
COMPARACIÓN DE CHECKPOINT: $NAME
============================
Archivos cambiados: X
Pruebas: +Y pasaron / -Z fallaron
Cobertura: +X% / -Y%
Build: [PASS/FAIL]
```

## Listar Checkpoints

Mostrar todos los checkpoints con:
- Nombre
- Marca de tiempo
- SHA de git
- Estado (actual, detrás, adelante)

## Flujo de Trabajo

Flujo típico de checkpoints:

```
[Inicio] --> /checkpoint create "feature-start"
   |
[Implementar] --> /checkpoint create "core-done"
   |
[Probar] --> /checkpoint verify "core-done"
   |
[Refactorizar] --> /checkpoint create "refactor-done"
   |
[PR] --> /checkpoint verify "feature-start"
```

## Argumentos

$ARGUMENTS:
- `create <nombre>` - Crear checkpoint con nombre
- `verify <nombre>` - Verificar contra checkpoint con nombre
- `list` - Mostrar todos los checkpoints
- `clear` - Eliminar checkpoints antiguos (conserva los últimos 5)
