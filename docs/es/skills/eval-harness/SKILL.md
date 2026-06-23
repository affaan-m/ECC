---
name: eval-harness
description: Framework formal de evaluación para sesiones de Claude Code que implementa principios de desarrollo orientado a evals (EDD)
origin: ECC
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Skill Eval Harness

Un framework formal de evaluación para sesiones de Claude Code, implementando principios de desarrollo orientado a evals (EDD).

## Cuándo Activar

- Configurar desarrollo orientado a evals (EDD) para flujos de trabajo asistidos por IA
- Definir criterios de pass/fail para la completitud de tareas en Claude Code
- Medir confiabilidad del agente con métricas pass@k
- Crear suites de pruebas de regresión para cambios de prompts o agentes
- Comparar rendimiento del agente entre versiones de modelos

## Filosofía

El Desarrollo Orientado a Evals trata los evals como las "pruebas unitarias del desarrollo de IA":
- Definir el comportamiento esperado ANTES de la implementación
- Ejecutar evals continuamente durante el desarrollo
- Rastrear regresiones con cada cambio
- Usar métricas pass@k para medición de confiabilidad

## Tipos de Eval

### Evals de Capacidad
Probar si Claude puede hacer algo que antes no podía:
```markdown
[CAPABILITY EVAL: feature-name]
Task: Descripción de lo que Claude debe lograr
Success Criteria:
  - [ ] Criterio 1
  - [ ] Criterio 2
  - [ ] Criterio 3
Expected Output: Descripción del resultado esperado
```

### Evals de Regresión
Asegurar que los cambios no rompan la funcionalidad existente:
```markdown
[REGRESSION EVAL: feature-name]
Baseline: SHA o nombre del checkpoint
Tests:
  - existing-test-1: PASS/FAIL
  - existing-test-2: PASS/FAIL
  - existing-test-3: PASS/FAIL
Result: X/Y pasaron (anteriormente Y/Y)
```

## Tipos de Evaluador

### 1. Evaluador Basado en Código
Verificaciones deterministas usando código:
```bash
# Verificar si el archivo contiene el patrón esperado
grep -q "export function handleAuth" src/auth.ts && echo "PASS" || echo "FAIL"

# Verificar si las pruebas pasan
npm test -- --testPathPattern="auth" && echo "PASS" || echo "FAIL"

# Verificar si el build tiene éxito
npm run build && echo "PASS" || echo "FAIL"
```

### 2. Evaluador Basado en Modelo
Usar Claude para evaluar salidas de forma abierta:
```markdown
[MODEL GRADER PROMPT]
Evalúa el siguiente cambio de código:
1. ¿Resuelve el problema declarado?
2. ¿Está bien estructurado?
3. ¿Se manejan los casos límite?
4. ¿El manejo de errores es apropiado?

Puntuación: 1-5 (1=pobre, 5=excelente)
Razonamiento: [explicación]
```

### 3. Evaluador Humano
Marcar para revisión manual:
```markdown
[HUMAN REVIEW REQUIRED]
Cambio: Descripción de qué cambió
Razón: Por qué se necesita revisión humana
Nivel de Riesgo: BAJO/MEDIO/ALTO
```

## Métricas

### pass@k
"Al menos un éxito en k intentos"
- pass@1: Tasa de éxito en el primer intento
- pass@3: Éxito dentro de 3 intentos
- Objetivo típico: pass@3 > 90%

### pass^k
"Todos los k ensayos tienen éxito"
- Barra más alta para confiabilidad
- pass^3: 3 éxitos consecutivos
- Usar para rutas críticas

## Flujo de Trabajo de Eval

### 1. Definir (Antes de Codificar)
```markdown
## EVAL DEFINITION: feature-xyz

### Capability Evals
1. Puede crear nueva cuenta de usuario
2. Puede validar formato de email
3. Puede hashear contraseña de forma segura

### Regression Evals
1. El login existente sigue funcionando
2. La gestión de sesiones no cambió
3. El flujo de logout está intacto

### Success Metrics
- pass@3 > 90% para evals de capacidad
- pass^3 = 100% para evals de regresión
```

### 2. Implementar
Escribir código para pasar los evals definidos.

### 3. Evaluar
```bash
# Ejecutar evals de capacidad
[Ejecutar cada eval de capacidad, registrar PASS/FAIL]

# Ejecutar evals de regresión
npm test -- --testPathPattern="existing"

# Generar reporte
```

### 4. Reportar
```markdown
EVAL REPORT: feature-xyz
========================

Capability Evals:
  create-user:     PASS (pass@1)
  validate-email:  PASS (pass@2)
  hash-password:   PASS (pass@1)
  Overall:         3/3 passed

Regression Evals:
  login-flow:      PASS
  session-mgmt:    PASS
  logout-flow:     PASS
  Overall:         3/3 passed

Metrics:
  pass@1: 67% (2/3)
  pass@3: 100% (3/3)

Status: READY FOR REVIEW
```

## Patrones de Integración

### Pre-Implementación
```
/eval define feature-name
```
Crea el archivo de definición de eval en `.claude/evals/feature-name.md`

### Durante la Implementación
```
/eval check feature-name
```
Ejecuta los evals actuales y reporta el estado

### Post-Implementación
```
/eval report feature-name
```
Genera el reporte completo de eval

## Almacenamiento de Evals

Almacenar evals en el proyecto:
```
.claude/
  evals/
    feature-xyz.md      # Definición de eval
    feature-xyz.log     # Historial de ejecuciones
    baseline.json       # Líneas base de regresión
```

## Buenas Prácticas

1. **Definir evals ANTES de codificar** — Fuerza pensar claramente sobre los criterios de éxito
2. **Ejecutar evals con frecuencia** — Detectar regresiones temprano
3. **Rastrear pass@k con el tiempo** — Monitorear tendencias de confiabilidad
4. **Usar evaluadores de código cuando sea posible** — Determinístico > probabilístico
5. **Revisión humana para seguridad** — Nunca automatizar completamente las verificaciones de seguridad
6. **Mantener los evals rápidos** — Los evals lentos no se ejecutan
7. **Versionar evals con el código** — Los evals son artefactos de primera clase

## Guía de pass@k

- `pass@1`: confiabilidad directa
- `pass@3`: confiabilidad práctica bajo reintentos controlados
- `pass^3`: prueba de estabilidad (las 3 ejecuciones deben pasar)

Umbrales recomendados:
- Evals de capacidad: pass@3 >= 0.90
- Evals de regresión: pass^3 = 1.00 para rutas críticas de release

## Anti-Patrones de Eval

- Sobreajustar prompts a ejemplos de eval conocidos
- Medir solo salidas del camino feliz
- Ignorar deriva de costo y latencia mientras se persiguen tasas de pass
- Permitir evaluadores inestables en compuertas de release
