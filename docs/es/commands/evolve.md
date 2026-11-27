---
name: evolve
description: Analizar instintos y sugerir o generar estructuras evolucionadas
command: true
---

# Comando Evolve

## Implementación

Ejecutar la CLI de instintos usando la ruta raíz del plugin:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" evolve [--generate]
```

O si `CLAUDE_PLUGIN_ROOT` no está configurado (instalación manual):

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py evolve [--generate]
```

Analiza los instintos y agrupa los relacionados en estructuras de nivel superior:
- **Comandos**: Cuando los instintos describen acciones invocadas por el usuario
- **Skills**: Cuando los instintos describen comportamientos activados automáticamente
- **Agentes**: Cuando los instintos describen procesos complejos de múltiples pasos

## Uso

```
/evolve                    # Analizar todos los instintos y sugerir evoluciones
/evolve --generate         # También generar archivos bajo evolved/{skills,commands,agents}
```

## Reglas de Evolución

### → Comando (Invocado por el Usuario)
Cuando los instintos describen acciones que un usuario solicitaría explícitamente:
- Múltiples instintos sobre "cuando el usuario pide..."
- Instintos con disparadores como "cuando se crea un nuevo X"
- Instintos que siguen una secuencia repetible

Ejemplo:
- `new-table-step1`: "cuando se añade una tabla de base de datos, crear migración"
- `new-table-step2`: "cuando se añade una tabla de base de datos, actualizar schema"
- `new-table-step3`: "cuando se añade una tabla de base de datos, regenerar tipos"

→ Crea: comando **new-table**

### → Skill (Activada Automáticamente)
Cuando los instintos describen comportamientos que deben ocurrir automáticamente:
- Disparadores de coincidencia de patrones
- Respuestas al manejo de errores
- Aplicación de estilo de código

Ejemplo:
- `prefer-functional`: "cuando se escriben funciones, preferir estilo funcional"
- `use-immutable`: "cuando se modifica estado, usar patrones inmutables"
- `avoid-classes`: "cuando se diseñan módulos, evitar diseño basado en clases"

→ Crea: skill `functional-patterns`

### → Agente (Necesita Profundidad/Aislamiento)
Cuando los instintos describen procesos complejos de múltiples pasos que se benefician del aislamiento:
- Flujos de trabajo de depuración
- Secuencias de refactorización
- Tareas de investigación

Ejemplo:
- `debug-step1`: "al depurar, primero revisar los logs"
- `debug-step2`: "al depurar, aislar el componente que falla"
- `debug-step3`: "al depurar, crear una reproducción mínima"
- `debug-step4`: "al depurar, verificar la corrección con una prueba"

→ Crea: agente **debugger**

## Qué Hacer

1. Detectar el contexto actual del proyecto
2. Leer los instintos del proyecto y globales (el proyecto tiene precedencia en conflictos de ID)
3. Agrupar los instintos por patrones de disparador/dominio
4. Identificar:
   - Candidatos a skill (clusters de disparadores con 2+ instintos)
   - Candidatos a comando (instintos de flujo de trabajo de alta confianza)
   - Candidatos a agente (clusters más grandes de alta confianza)
5. Mostrar candidatos a promoción (proyecto → global) cuando corresponda
6. Si se pasa `--generate`, escribir archivos en:
   - Alcance del proyecto: `~/.claude/homunculus/projects/<project-id>/evolved/`
   - Respaldo global: `~/.claude/homunculus/evolved/`

## Formato de Salida

```
============================================================
  ANÁLISIS EVOLVE - 12 instintos
  Proyecto: my-app (a1b2c3d4e5f6)
  Con alcance de proyecto: 8 | Global: 4
============================================================

Instintos de alta confianza (>=80%): 5

## CANDIDATOS A SKILL
1. Cluster: "adding tests"
   Instintos: 3
   Confianza promedio: 82%
   Dominios: testing
   Alcances: proyecto

## CANDIDATOS A COMANDO (2)
  /adding-tests
    De: test-first-workflow [proyecto]
    Confianza: 84%

## CANDIDATOS A AGENTE (1)
  adding-tests-agent
    Cubre 3 instintos
    Confianza promedio: 82%
```

## Flags

- `--generate`: Generar archivos evolucionados además de la salida de análisis

## Formato de Archivo Generado

### Comando
```markdown
---
name: new-table
description: Crear una nueva tabla de base de datos con migración, actualización de schema y generación de tipos
command: /new-table
evolved_from:
  - new-table-migration
  - update-schema
  - regenerate-types
---

# Comando New Table

[Contenido generado basado en instintos agrupados]

## Pasos
1. ...
2. ...
```

### Skill
```markdown
---
name: functional-patterns
description: Reforzar patrones de programación funcional
evolved_from:
  - prefer-functional
  - use-immutable
  - avoid-classes
---

# Skill de Patrones Funcionales

[Contenido generado basado en instintos agrupados]
```

### Agente
```markdown
---
name: debugger
description: Agente de depuración sistemática
model: sonnet
evolved_from:
  - debug-check-logs
  - debug-isolate
  - debug-reproduce
---

# Agente Debugger

[Contenido generado basado en instintos agrupados]
```
