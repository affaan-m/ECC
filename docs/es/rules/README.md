# Reglas (Rules)

Convenciones de codificación y mejores prácticas para Claude Code.

## Estructura de Directorios

### Common (Reglas Independientes del Lenguaje)

Reglas fundamentales que aplican a todos los lenguajes de programación:

- **agents.md** - Orquestación y uso de agentes
- **coding-style.md** - Reglas generales de estilo de código (inmutabilidad, organización de archivos, manejo de errores)
- **development-workflow.md** - Flujo de trabajo de desarrollo de features (investigación, planificación, TDD, revisión de código)
- **git-workflow.md** - Flujo de trabajo de commits y PRs en Git
- **hooks.md** - Sistema de hooks (PreToolUse, PostToolUse, Stop)
- **patterns.md** - Patrones de diseño comunes (Repository, Formato de Respuesta de API)
- **performance.md** - Optimización de rendimiento (selección de modelo, gestión de la ventana de contexto)
- **security.md** - Reglas de seguridad (gestión de secretos, verificaciones de seguridad)
- **testing.md** - Requisitos de pruebas (TDD, cobertura mínima del 80%)

### TypeScript/JavaScript

Reglas específicas para proyectos TypeScript y JavaScript:

- **coding-style.md** - Sistemas de tipos, inmutabilidad, manejo de errores, validación de entrada
- **hooks.md** - Prettier, verificación de TypeScript, advertencias de console.log
- **patterns.md** - Formato de respuesta de API, custom hooks, patrón Repository
- **security.md** - Gestión de secretos, variables de entorno
- **testing.md** - Testing E2E con Playwright

### Python

Reglas específicas para proyectos Python:

- **coding-style.md** - PEP 8, anotaciones de tipos, inmutabilidad, herramientas de formateo
- **hooks.md** - Formateo con black/ruff, verificación de tipos con mypy/pyright
- **patterns.md** - Protocol (duck typing), dataclasses, context managers
- **security.md** - Gestión de secretos, escaneo de seguridad con bandit
- **testing.md** - Framework pytest, cobertura, organización de pruebas

### Golang

Reglas específicas para proyectos Go:

- **coding-style.md** - gofmt/goimports, principios de diseño, manejo de errores
- **hooks.md** - Formateo con gofmt/goimports, go vet, staticcheck
- **patterns.md** - Functional options, interfaces pequeñas, inyección de dependencias
- **security.md** - Gestión de secretos, escaneo de seguridad con gosec, context y timeouts
- **testing.md** - Pruebas table-driven, detección de condiciones de carrera, cobertura

## Uso

Estas reglas son cargadas y aplicadas automáticamente por Claude Code. Las reglas:

1. **Independientes del lenguaje** - Las reglas en el directorio `common/` aplican a todos los proyectos
2. **Específicas por lenguaje** - Las reglas en los directorios de lenguaje (typescript/, python/, golang/) extienden las reglas comunes
3. **Basadas en rutas** - Las reglas se aplican a archivos que coinciden con los patrones de rutas en el frontmatter YAML

## Documentación Original

El original en inglés de esta documentación se encuentra en el directorio `rules/`.
