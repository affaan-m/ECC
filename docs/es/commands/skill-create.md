---
name: skill-create
description: Analizar el historial local de git para extraer patrones de codificación y generar archivos SKILL.md. Versión local de la Skill Creator GitHub App.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /skill-create - Generación Local de Skills

Analizar el historial de git de tu repositorio para extraer patrones de codificación y generar archivos SKILL.md que enseñan a Claude las prácticas de tu equipo.

## Uso

```bash
/skill-create                    # Analizar el repositorio actual
/skill-create --commits 100      # Analizar los últimos 100 commits
/skill-create --output ./skills  # Directorio de salida personalizado
/skill-create --instincts        # También generar instintos para continuous-learning-v2
```

## Qué Hace

1. **Parsear Historial de Git** - Analizar commits, cambios de archivos y patrones
2. **Detectar Patrones** - Identificar flujos de trabajo y convenciones recurrentes
3. **Generar SKILL.md** - Crear archivos de skill válidos de Claude Code
4. **Opcionalmente Crear Instintos** - Para el sistema continuous-learning-v2

## Pasos de Análisis

### Paso 1: Recopilar Datos de Git

```bash
# Obtener commits recientes con cambios de archivos
git log --oneline -n ${COMMITS:-200} --name-only --pretty=format:"%H|%s|%ad" --date=short

# Obtener frecuencia de commits por archivo
git log --oneline -n 200 --name-only | grep -v "^$" | grep -v "^[a-f0-9]" | sort | uniq -c | sort -rn | head -20

# Obtener patrones de mensajes de commit
git log --oneline -n 200 | cut -d' ' -f2- | head -50
```

### Paso 2: Detectar Patrones

| Patrón | Método de Detección |
|--------|---------------------|
| **Convenciones de commit** | Regex en mensajes de commit (feat:, fix:, chore:) |
| **Co-cambios de archivos** | Archivos que siempre cambian juntos |
| **Secuencias de flujo de trabajo** | Patrones de cambio de archivos repetidos |
| **Arquitectura** | Estructura de carpetas y convenciones de nomenclatura |
| **Patrones de testing** | Ubicaciones de archivos de prueba, nomenclatura, cobertura |

### Paso 3: Generar SKILL.md

```markdown
---
name: {nombre-repo}-patterns
description: Patrones de codificación extraídos de {nombre-repo}
version: 1.0.0
source: local-git-analysis
analyzed_commits: {cantidad}
---

# Patrones de {Nombre Repo}

## Convenciones de Commit
{patrones detectados en mensajes de commit}

## Arquitectura del Código
{estructura de carpetas y organización detectadas}

## Flujos de Trabajo
{patrones de cambio de archivos repetidos detectados}

## Patrones de Testing
{convenciones de pruebas detectadas}
```

## Integración con GitHub App

Para funciones avanzadas (10k+ commits, compartir en equipo, PRs automáticos), usar la [Skill Creator GitHub App](https://github.com/apps/skill-creator):

- Comentar `/skill-creator analyze` en cualquier issue
- Recibe un PR con las skills generadas

## Comandos Relacionados

- `/instinct-import` - Importar instintos generados
- `/instinct-status` - Ver instintos aprendidos
- `/evolve` - Agrupar instintos en skills/agentes
