# Optimización de Rendimiento

## Estrategia de Selección de Modelos

**Haiku 4.5** (90% de la capacidad de Sonnet, 3x ahorro de costos):
- Agentes ligeros con invocación frecuente
- Programación en pareja y generación de código
- Agentes workers en sistemas multi-agente

**Sonnet 4.6** (Mejor modelo para codificación):
- Trabajo de desarrollo principal
- Orquestación de flujos de trabajo multi-agente
- Tareas de codificación complejas

**Opus 4.5** (Razonamiento más profundo):
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

El extended thinking está habilitado por defecto, reservando hasta 31,999 tokens para razonamiento interno.

Controlar el extended thinking mediante:
- **Toggle**: Option+T (macOS) / Alt+T (Windows/Linux)
- **Config**: Establecer `alwaysThinkingEnabled` en `~/.claude/settings.json`
- **Límite de presupuesto**: `export MAX_THINKING_TOKENS=10000`
- **Modo verbose**: Ctrl+O para ver la salida del pensamiento

Para tareas complejas que requieren razonamiento profundo:
1. Asegurarse de que el extended thinking esté habilitado (activado por defecto)
2. Habilitar el **Modo Plan** para un enfoque estructurado
3. Usar múltiples rondas de crítica para un análisis exhaustivo
4. Usar sub-agentes con roles divididos para perspectivas diversas

## Solución de Problemas de Build

Si el build falla:
1. Usar el agente **build-error-resolver**
2. Analizar los mensajes de error
3. Corregir de forma incremental
4. Verificar después de cada corrección
