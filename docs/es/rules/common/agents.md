# Orquestación de Agentes

## Agentes Disponibles

Ubicados en `~/.claude/agents/`:

| Agente | Propósito | Cuándo Usar |
|--------|-----------|-------------|
| planner | Planificación de implementación | Features complejas, refactoring |
| architect | Diseño de sistemas | Decisiones arquitectónicas |
| tdd-guide | Desarrollo guiado por pruebas | Nuevas features, corrección de bugs |
| code-reviewer | Revisión de código | Después de escribir código |
| security-reviewer | Análisis de seguridad | Antes de los commits |
| build-error-resolver | Corrección de errores de build | Cuando el build falla |
| e2e-runner | Testing E2E | Flujos de usuario críticos |
| refactor-cleaner | Limpieza de código muerto | Mantenimiento de código |
| doc-updater | Documentación | Actualización de docs |
| rust-reviewer | Revisión de código Rust | Proyectos Rust |
| harmonyos-app-resolver | Desarrollo de apps HarmonyOS | Proyectos HarmonyOS/ArkTS |

## Uso Inmediato de Agentes

Sin necesidad de prompt del usuario:
1. Solicitudes de features complejas - Usar el agente **planner**
2. Código recién escrito/modificado - Usar el agente **code-reviewer**
3. Corrección de bug o nueva feature - Usar el agente **tdd-guide**
4. Decisión arquitectónica - Usar el agente **architect**

## Ejecución Paralela de Tareas

SIEMPRE usar ejecución paralela de tareas para operaciones independientes:

```markdown
# CORRECTO: Ejecución paralela
Lanzar 3 agentes en paralelo:
1. Agente 1: Análisis de seguridad del módulo de auth
2. Agente 2: Revisión de rendimiento del sistema de caché
3. Agente 3: Verificación de tipos de las utilidades

# INCORRECTO: Secuencial cuando no es necesario
Primero agente 1, luego agente 2, luego agente 3
```

## Análisis Multi-Perspectiva

Para problemas complejos, usar sub-agentes con roles divididos:
- Revisor factual
- Ingeniero senior
- Experto en seguridad
- Revisor de consistencia
- Verificador de redundancias
