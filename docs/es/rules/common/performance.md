# Optimización de Rendimiento

## Estrategia de Selección de Modelos

**Haiku 4.5** (90% de la capacidad de Sonnet, 3x ahorro de costos):
- Agentes ligeros con invocación frecuente
- Programación en pareja y generación de código
- Agentes workers en sistemas multi-agente

**Sonnet 5** (Mejor modelo para codificación):
- Trabajo de desarrollo principal
- Orquestación de flujos de trabajo multi-agente
- Tareas de codificación complejas

**Opus 5** (Razonamiento más profundo):
- Decisiones arquitectónicas complejas
- Requisitos de razonamiento máximo
- Tareas de investigación y análisis

## Gestión de la Ventana de Contexto

Evitar el último 20% de la ventana de contexto para:
- Refactoring a gran escala
- Implementación de features que abarca múltiples archivos
- Depuración de interacciones complejas

Tareas con menor sensibilidad al contexto:
- Ediciones de un solo archivo
- Creación de utilidades independientes
- Actualizaciones de documentación
- Correcciones de bugs simples

## Extended Thinking + Modo Plan

En Claude Code, el razonamiento adaptativo permite que el modelo decida cuánto pensar en cada tarea. Para los modelos Fable, Sonnet 5 y posteriores, y Opus 4.7 y posteriores, usa el effort para controlar el razonamiento en lugar de un presupuesto fijo de tokens. Los niveles disponibles dependen del modelo.

Controla el extended thinking mediante:
- **Effort**: Usa `/effort` dentro de una sesión, `--effort <level>` al iniciar, o `CLAUDE_CODE_EFFORT_LEVEL`. Guarda un nivel por modelo en `modelSettings` dentro de `~/.claude/settings.json`; la clave anterior a nivel de usuario `effortLevel` no se aplica a Opus 5.5 ni a modelos más nuevos.
- **Toggle**: Option+T (macOS) / Alt+T (Windows/Linux), o `alwaysThinkingEnabled` en la configuración. Estas opciones no pueden desactivar el pensamiento en Opus 5.5, Sonnet 5.5 ni en los modelos Fable.
- **Presupuesto fijo**: Claude Code ignora los valores positivos de `MAX_THINKING_TOKENS` en modelos con razonamiento adaptativo. En Opus 4.6 o Sonnet 4.6, establece `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` para usar un presupuesto fijo con `MAX_THINKING_TOKENS`.
- **Modo verbose**: Ctrl+O para ver la salida del pensamiento

Consulta la [configuración de modelos de Claude Code](https://code.claude.com/docs/en/model-config#adjust-effort-level) y las [variables de entorno](https://code.claude.com/docs/en/env-vars) para los controles admitidos.

Para tareas complejas que requieren razonamiento profundo:
1. Elige un nivel de effort más alto y admitido, como `/effort high`
2. Habilita el **Modo Plan** para un enfoque estructurado
3. Usa múltiples rondas de crítica para un análisis exhaustivo
4. Usa sub-agentes con roles divididos para perspectivas diversas

## Solución de Problemas de Build

Si el build falla:
1. Usar el agente **build-error-resolver**
2. Analizar los mensajes de error
3. Corregir de forma incremental
4. Verificar después de cada corrección
