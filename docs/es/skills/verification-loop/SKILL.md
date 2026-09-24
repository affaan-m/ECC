---
name: verification-loop
description: "Sistema de verificación completo para sesiones de Claude Code."
origin: ECC
---

# Skill de Bucle de Verificación

Sistema de verificación completo para sesiones de Claude Code.

## Cuándo Usar

Invocar este skill:
- Después de completar una funcionalidad o cambio de código significativo
- Antes de crear un PR
- Cuando se quiere garantizar que las compuertas de calidad pasen
- Después de refactorizar

## Fases de Verificación

### Fase 1: Verificación del Build
```bash
# Verificar si el proyecto compila
npm run build 2>&1 | tail -20
# O
pnpm build 2>&1 | tail -20
```

Si el build falla, DETENER y corregir antes de continuar.

### Fase 2: Verificación de Tipos
```bash
# Proyectos TypeScript
npx tsc --noEmit 2>&1 | head -30

# Proyectos Python
pyright . 2>&1 | head -30
```

Reportar todos los errores de tipo. Corregir los críticos antes de continuar.

### Fase 3: Verificación de Lint
```bash
# JavaScript/TypeScript
npm run lint 2>&1 | head -30

# Python
ruff check . 2>&1 | head -30
```

### Fase 4: Suite de Pruebas
```bash
# Ejecutar pruebas con cobertura
npm run test -- --coverage 2>&1 | tail -50

# Verificar umbral de cobertura
# Objetivo: mínimo 80%
```

Reportar:
- Total de pruebas: X
- Pasadas: X
- Fallidas: X
- Cobertura: X%

### Fase 5: Escaneo de Seguridad
```bash
# Verificar secretos
grep -rn "sk-" --include="*.ts" --include="*.js" . 2>/dev/null | head -10
grep -rn "api_key" --include="*.ts" --include="*.js" . 2>/dev/null | head -10

# Verificar console.log
grep -rn "console.log" --include="*.ts" --include="*.tsx" src/ 2>/dev/null | head -10
```

### Fase 6: Revisión de Diff
```bash
# Mostrar qué cambió
git diff --stat
git diff HEAD~1 --name-only
```

Revisar cada archivo modificado en busca de:
- Cambios no intencionados
- Manejo de errores faltante
- Casos borde potenciales

## Formato de Salida

Después de ejecutar todas las fases, producir un reporte de verificación:

```
REPORTE DE VERIFICACIÓN
=======================

Build:      [PASS/FAIL]
Tipos:      [PASS/FAIL] (X errores)
Lint:       [PASS/FAIL] (X advertencias)
Pruebas:    [PASS/FAIL] (X/Y pasadas, Z% cobertura)
Seguridad:  [PASS/FAIL] (X problemas)
Diff:       [X archivos modificados]

General:    [LISTO/NO LISTO] para PR

Problemas a Corregir:
1. ...
2. ...
```

## Modo Continuo

Para sesiones largas, ejecutar la verificación cada 15 minutos o después de cambios importantes:

```markdown
Establecer un checkpoint mental:
- Después de completar cada función
- Después de terminar un componente
- Antes de pasar a la siguiente tarea

Ejecutar: /verify
```

## Integración con Hooks

Este skill complementa los hooks PostToolUse pero proporciona una verificación más profunda.
Los hooks detectan problemas de inmediato; este skill proporciona una revisión completa.
