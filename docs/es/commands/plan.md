---
description: Reformular requisitos, evaluar riesgos y crear un plan de implementación paso a paso. ESPERAR confirmación del usuario antes de tocar cualquier código.
argument-hint: "[descripción de la funcionalidad | ruta/a/*.prd.md]"
---

# Comando Plan

Este comando crea un plan de implementación completo antes de escribir cualquier código. Acepta tanto requisitos en texto libre como un archivo PRD en Markdown.

Ejecutar inline por defecto. No llamar a la herramienta Task ni a ningún subagente por defecto.

## Qué Hace Este Comando

1. **Reformular Requisitos** - Aclarar qué necesita construirse
2. **Identificar Riesgos** - Detectar problemas potenciales y bloqueadores
3. **Crear Plan de Pasos** - Descomponer la implementación en fases
4. **Esperar Confirmación** - DEBE recibir aprobación del usuario antes de proceder

## Cuándo Usar

Usar `/plan` cuando:
- Se empieza una nueva funcionalidad
- Se hacen cambios arquitectónicos significativos
- Se trabaja en refactorización compleja
- Múltiples archivos/componentes se verán afectados
- Los requisitos no están claros o son ambiguos

## Cómo Funciona

El asistente:

1. **Analiza la solicitud** y reformula los requisitos en términos claros
2. **Fundamenta el plan** en patrones relevantes del código base cuando el repositorio está disponible
3. **Descompone en fases** con pasos específicos y accionables
4. **Identifica dependencias** entre componentes
5. **Evalúa riesgos** y posibles bloqueadores
6. **Estima la complejidad** (Alta/Media/Baja)
7. **Presenta el plan** y ESPERA tu confirmación explícita

## Modos de Entrada

| Entrada | Modo | Comportamiento |
|---------|------|---------------|
| `ruta/al/nombre.prd.md` | Modo artefacto PRD | Leer el PRD, elegir el próximo hito de entrega pendiente y escribir `.claude/plans/{nombre}.plan.md` |
| Cualquier otra ruta markdown | Modo referencia | Leer el archivo como contexto y producir un plan inline |
| Texto libre | Modo conversacional | Producir un plan inline |
| Entrada vacía | Modo aclaración | Preguntar qué debe planificarse |

## Fundamentación en Patrones

Antes de escribir el plan, buscar en el código base las convenciones que la implementación debe replicar:

| Categoría | Qué capturar |
|-----------|-------------|
| Nomenclatura | Archivo, función, tipo, comando o nomenclatura de scripts en el área afectada |
| Manejo de errores | Cómo se generan, retornan, registran o manejan los fallos |
| Logging | Niveles, formato y qué se registra |
| Acceso a datos | Patrones de repositorio, servicio, consulta o sistema de archivos |
| Pruebas | Ubicación de archivos de prueba, framework, fixtures y estilo de afirmaciones |

## Ejemplo de Uso

```
Usuario: /plan Necesito añadir notificaciones en tiempo real cuando los mercados se resuelven

Asistente:
# Plan de Implementación: Notificaciones de Resolución de Mercados en Tiempo Real

## Reformulación de Requisitos
- Enviar notificaciones a usuarios cuando los mercados que observan se resuelven
- Soporte para múltiples canales (en-app, email, webhook)
- Asegurar entrega confiable de notificaciones

## Fases de Implementación

### Fase 1: Schema de Base de Datos
- Añadir tabla de notificaciones con columnas: id, user_id, market_id, type, status, created_at

### Fase 2: Servicio de Notificaciones
- Crear servicio en lib/notifications.ts
- Implementar cola de notificaciones con BullMQ/Redis

## Riesgos
- ALTO: Entregabilidad de email (SPF/DKIM requerido)
- MEDIO: Rendimiento con 1000+ usuarios por mercado

## Complejidad Estimada: MEDIA

**ESPERANDO CONFIRMACIÓN**: ¿Proceder con este plan? (sí/no/modificar)
```

## Notas Importantes

**CRÍTICO**: Este comando **NO** escribirá ningún código hasta que confirmes explícitamente el plan con "sí", "proceder" o respuesta afirmativa similar.

## Integración con Otros Comandos

Después de planificar:
- Usar la skill `tdd-workflow` para implementar con desarrollo guiado por pruebas
- Usar `/build-fix` si ocurren errores de build
- Usar `/code-review` para revisar la implementación completada
- Usar `/pr` o `/prp-pr` para abrir un pull request

## Agente Planificador Opcional

ECC también proporciona un agente `planner` para instalaciones manuales que incluyen archivos de agente. Usarlo solo cuando el runtime local ya expone ese subagente y el usuario lo pide explícitamente.

El archivo fuente se encuentra en:
`agents/planner.md`
