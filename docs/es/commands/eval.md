# Comando Eval

Gestionar el flujo de trabajo de desarrollo orientado a evals.

## Uso

`/eval [define|check|report|list] [nombre-feature]`

## Definir Eval

`/eval define nombre-feature`

Crear una nueva definición de eval:

1. Crear `.claude/evals/nombre-feature.md` con la plantilla:

```markdown
## EVAL: nombre-feature
Created: $(date)

### Capability Evals
- [ ] [Descripción de Capability 1]
- [ ] [Descripción de Capability 2]

### Regression Evals
- [ ] [El comportamiento existente 1 sigue funcionando]
- [ ] [El comportamiento existente 2 sigue funcionando]

### Success Criteria
- pass@3 > 90% para capability evals
- pass^3 = 100% para regression evals
```

2. Pedir al usuario que complete los criterios específicos

## Verificar Eval

`/eval check nombre-feature`

Ejecutar los evals para una feature:

1. Leer la definición de eval desde `.claude/evals/nombre-feature.md`
2. Para cada capability eval:
   - Intentar verificar el criterio
   - Registrar PASS/FAIL
   - Guardar el intento en `.claude/evals/nombre-feature.log`
3. Para cada regression eval:
   - Ejecutar las pruebas relevantes
   - Comparar con la línea base
   - Registrar PASS/FAIL
4. Reportar el estado actual:

```
EVAL CHECK: nombre-feature
========================
Capability: X/Y pasando
Regression: X/Y pasando
Estado: EN PROGRESO / LISTO
```

## Reporte de Eval

`/eval report nombre-feature`

Generar reporte exhaustivo de eval:

```
EVAL REPORT: nombre-feature
=========================
Generated: $(date)

CAPABILITY EVALS
----------------
[eval-1]: PASS (pass@1)
[eval-2]: PASS (pass@2) - requirió reintento
[eval-3]: FAIL - ver notas

REGRESSION EVALS
----------------
[test-1]: PASS
[test-2]: PASS
[test-3]: PASS

METRICS
-------
Capability pass@1: 67%
Capability pass@3: 100%
Regression pass^3: 100%

NOTES
-----
[Cualquier problema, caso límite u observación]

RECOMMENDATION
--------------
[SHIP / NEEDS WORK / BLOCKED]
```

## Listar Evals

`/eval list`

Mostrar todas las definiciones de eval:

```
EVAL DEFINITIONS
================
feature-auth      [3/5 pasando] EN PROGRESO
feature-search    [5/5 pasando] LISTO
feature-export    [0/4 pasando] NO INICIADO
```

## Argumentos

$ARGUMENTS:
- `define <nombre>` - Crear nueva definición de eval
- `check <nombre>` - Ejecutar y verificar evals
- `report <nombre>` - Generar reporte completo
- `list` - Mostrar todos los evals
- `clean` - Eliminar logs de evals antiguos (mantiene las últimas 10 ejecuciones)
