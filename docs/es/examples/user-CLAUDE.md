# Ejemplo de CLAUDE.md a Nivel de Usuario

Este es un ejemplo de archivo CLAUDE.md a nivel de usuario. Colocarlo en `~/.claude/CLAUDE.md`.

Las configuraciones a nivel de usuario aplican globalmente en todos los proyectos. Úsalas para:
- Preferencias personales de codificación
- Reglas universales que siempre quieres aplicar
- Enlaces a tus reglas modulares

---

## Filosofía Central

Eres Claude Code. Uso agentes especializados y skills para tareas complejas.

**Principios Clave:**
1. **Agente-Primero**: Delegar a agentes especializados para trabajo complejo
2. **Ejecución Paralela**: Usar la herramienta Task con múltiples agentes cuando sea posible
3. **Planificar Antes de Ejecutar**: Usar el Modo Plan para operaciones complejas
4. **Guiado por Pruebas**: Escribir pruebas antes de la implementación
5. **Seguridad-Primero**: Nunca comprometer la seguridad

---

## Reglas Modulares

Las directrices detalladas están en `~/.claude/rules/`:

| Archivo de Regla | Contenido |
|-----------|----------|
| security.md | Verificaciones de seguridad, gestión de secretos |
| coding-style.md | Inmutabilidad, organización de archivos, manejo de errores |
| testing.md | Flujo de trabajo TDD, requisito de cobertura del 80% |
| git-workflow.md | Formato de commit, flujo de trabajo de PR |
| agents.md | Orquestación de agentes, cuándo usar cuál agente |
| patterns.md | Respuesta de API, patrones repository |
| performance.md | Selección de modelo, gestión del contexto |
| hooks.md | Sistema de hooks |

---

## Agentes Disponibles

Ubicados en `~/.claude/agents/`:

| Agente | Propósito |
|-------|---------|
| planner | Planificación de implementación de features |
| architect | Diseño de sistemas y arquitectura |
| tdd-guide | Desarrollo guiado por pruebas |
| code-reviewer | Revisión de código para calidad/seguridad |
| security-reviewer | Análisis de vulnerabilidades de seguridad |
| build-error-resolver | Resolución de errores de build |
| e2e-runner | Testing E2E con Playwright |
| refactor-cleaner | Limpieza de código muerto |
| doc-updater | Actualizaciones de documentación |

---

## Preferencias Personales

### Privacidad
- Siempre redactar logs; nunca pegar secretos (claves de API/tokens/contraseñas/JWTs)
- Revisar la salida antes de compartir - eliminar cualquier dato sensible

### Estilo de Código
- Sin emojis en código, comentarios ni documentación
- Preferir inmutabilidad - nunca mutar objetos o arrays
- Muchos archivos pequeños en lugar de pocos archivos grandes
- 200-400 líneas típico, 800 máximo por archivo

### Git
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- Siempre probar localmente antes de hacer commit
- Commits pequeños y enfocados

### Pruebas
- TDD: Escribir pruebas primero
- Cobertura mínima del 80%
- Unit + integración + E2E para flujos críticos

### Captura de Conocimiento
- Notas de depuración personales, preferencias y contexto temporal → memoria automática
- Conocimiento del equipo/proyecto (decisiones de arquitectura, cambios de API, runbooks de implementación) → seguir la estructura de docs existente del proyecto
- Si la tarea actual ya produce los docs, comentarios o ejemplos relevantes, no duplicar el mismo conocimiento en otro lugar
- Si no hay una ubicación obvia en los docs del proyecto, preguntar antes de crear un nuevo doc de nivel superior

---

## Integración con Editor

Uso Zed como editor principal:
- Panel de Agentes para rastreo de archivos
- CMD+Shift+R para la paleta de comandos
- Modo Vim habilitado

---

## Métricas de Éxito

Tienes éxito cuando:
- Todas las pruebas pasan (80%+ de cobertura)
- Sin vulnerabilidades de seguridad
- El código es legible y mantenible
- Los requisitos del usuario se cumplen

---

**Filosofía**: Diseño agente-primero, ejecución paralela, planificar antes de actuar, probar antes de codificar, seguridad siempre.
