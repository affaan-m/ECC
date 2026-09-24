# Everything Claude Code (ECC) — Instrucciones para Agentes

Este es un **plugin de IA para codificación listo para producción** que proporciona 63 agentes especializados, 249 skills, 79 comandos y flujos de trabajo de hooks automatizados para el desarrollo de software.

**Versión:** 2.0.0-rc.1

## Principios Fundamentales

1. **Primero los Agentes** — Delega a agentes especializados para tareas de dominio
2. **Guiado por Pruebas** — Escribe pruebas antes de la implementación, se requiere 80%+ de cobertura
3. **Seguridad Primero** — Nunca comprometer la seguridad; valida todas las entradas
4. **Inmutabilidad** — Siempre crea nuevos objetos, nunca mutes los existentes
5. **Planifica Antes de Ejecutar** — Planifica features complejas antes de escribir código

## Agentes Disponibles

| Agente | Propósito | Cuándo Usar |
|--------|---------|-------------|
| planner | Planificación de implementación | Features complejas, refactorización |
| architect | Diseño del sistema y escalabilidad | Decisiones arquitectónicas |
| tdd-guide | Desarrollo guiado por pruebas | Nuevas features, corrección de bugs |
| code-reviewer | Calidad y mantenibilidad del código | Después de escribir/modificar código |
| security-reviewer | Detección de vulnerabilidades | Antes de commits, código sensible |
| build-error-resolver | Corregir errores de build/tipos | Cuando el build falla |
| e2e-runner | Pruebas E2E con Playwright | Flujos de usuario críticos |
| refactor-cleaner | Limpieza de código muerto | Mantenimiento del código |
| doc-updater | Documentación y codemaps | Actualización de docs |
| cpp-reviewer | Revisión de código C/C++ | Proyectos en C y C++ |
| cpp-build-resolver | Errores de build en C/C++ | Fallos de build en C y C++ |
| fsharp-reviewer | Revisión de código funcional en F# | Proyectos en F# |
| docs-lookup | Búsqueda de documentación mediante Context7 | Preguntas de API/docs |
| go-reviewer | Revisión de código Go | Proyectos en Go |
| go-build-resolver | Errores de build en Go | Fallos de build en Go |
| kotlin-reviewer | Revisión de código Kotlin | Proyectos Kotlin/Android/KMP |
| kotlin-build-resolver | Errores de build en Kotlin/Gradle | Fallos de build en Kotlin |
| database-reviewer | Especialista en PostgreSQL/Supabase | Diseño de esquemas, optimización de consultas |
| python-reviewer | Revisión de código Python | Proyectos en Python |
| django-reviewer | Revisión de código Django | Apps Django, APIs DRF, ORM, migraciones |
| django-build-resolver | Errores de build, migración y configuración de Django | Fallos de inicio, dependencias, migraciones, collectstatic de Django |
| java-reviewer | Revisión de código Java y Spring Boot | Proyectos Java/Spring Boot |
| java-build-resolver | Errores de build en Java/Maven/Gradle | Fallos de build en Java |
| loop-operator | Ejecución autónoma de bucles | Ejecutar bucles de forma segura, monitorear bloqueos, intervenir |
| harness-optimizer | Ajuste de configuración del harness | Confiabilidad, costo, rendimiento |
| rust-reviewer | Revisión de código Rust | Proyectos en Rust |
| rust-build-resolver | Errores de build en Rust | Fallos de build en Rust |
| pytorch-build-resolver | Errores de runtime/CUDA/entrenamiento en PyTorch | Fallos de build/entrenamiento en PyTorch |
| mle-reviewer | Revisión de pipeline de ML en producción | Pipelines de ML, evaluaciones, serving, monitoreo, rollback |
| typescript-reviewer | Revisión de código TypeScript/JavaScript | Proyectos TypeScript/JavaScript |

## Orquestación de Agentes

Usa agentes proactivamente sin prompt del usuario:
- Solicitudes de features complejas → **planner**
- Código recién escrito/modificado → **code-reviewer**
- Corrección de bug o nueva feature → **tdd-guide**
- Decisión arquitectónica → **architect**
- Código sensible a la seguridad → **security-reviewer**
- Bucles autónomos / monitoreo de bucles → **loop-operator**
- Confiabilidad y costo de la configuración del harness → **harness-optimizer**

Usa ejecución paralela para operaciones independientes — lanza múltiples agentes simultáneamente.

## Directrices de Seguridad

**Antes de CUALQUIER commit:**
- Sin secretos codificados (claves de API, contraseñas, tokens)
- Todas las entradas del usuario validadas
- Prevención de inyección SQL (consultas parametrizadas)
- Prevención de XSS (HTML sanitizado)
- Protección CSRF habilitada
- Autenticación/autorización verificada
- Limitación de tasa en todos los endpoints
- Los mensajes de error no filtran datos sensibles

**Gestión de secretos:** NUNCA codifiques secretos. Usa variables de entorno o un gestor de secretos. Valida los secretos requeridos en el inicio. Rota inmediatamente cualquier secreto expuesto.

**Si se encuentra un problema de seguridad:** DETENTE → usa el agente security-reviewer → corrige los problemas CRÍTICOS → rota los secretos expuestos → revisa el código base en busca de problemas similares.

## Estilo de Código

**Inmutabilidad (CRÍTICO):** Siempre crea nuevos objetos, nunca mutes. Devuelve nuevas copias con los cambios aplicados.

**Organización de archivos:** Muchos archivos pequeños en lugar de pocos grandes. 200-400 líneas típico, 800 máx. Organiza por feature/dominio, no por tipo. Alta cohesión, bajo acoplamiento.

**Manejo de errores:** Maneja errores en cada nivel. Proporciona mensajes amigables al usuario en el código de UI. Registra contexto detallado del lado del servidor. Nunca silencies errores.

**Validación de entradas:** Valida todas las entradas del usuario en los límites del sistema. Usa validación basada en esquemas. Falla rápido con mensajes claros. Nunca confíes en datos externos.

**Lista de verificación de calidad del código:**
- Funciones pequeñas (<50 líneas), archivos enfocados (<800 líneas)
- Sin anidamiento profundo (>4 niveles)
- Manejo de errores correcto, sin valores codificados
- Identificadores legibles y bien nombrados

## Requisitos de Pruebas

**Cobertura mínima: 80%**

Tipos de prueba (todos requeridos):
1. **Pruebas unitarias** — Funciones individuales, utilidades, componentes
2. **Pruebas de integración** — Endpoints de API, operaciones de base de datos
3. **Pruebas E2E** — Flujos de usuario críticos

**Flujo de trabajo TDD (obligatorio):**
1. Escribe la prueba primero (ROJO) — la prueba debe FALLAR
2. Escribe la implementación mínima (VERDE) — la prueba debe PASAR
3. Refactoriza (MEJORAR) — verifica cobertura 80%+

Soluciona fallos: verifica aislamiento de pruebas → verifica mocks → corrige la implementación (no las pruebas, a menos que las pruebas estén equivocadas).

## Flujo de Trabajo de Desarrollo

1. **Planificar** — Usa el agente planner, identifica dependencias y riesgos, divide en fases
2. **TDD** — Usa el agente tdd-guide, escribe pruebas primero, implementa, refactoriza
3. **Revisar** — Usa el agente code-reviewer de inmediato, atiende los problemas CRÍTICOS/ALTOS
4. **Captura el conocimiento en el lugar correcto**
   - Notas de depuración personal, preferencias y contexto temporal → auto memoria
   - Conocimiento del equipo/proyecto (decisiones de arquitectura, cambios de API, runbooks) → la estructura de documentos existente del proyecto
   - Si la tarea actual ya produce los documentos o comentarios de código relevantes, no dupliques la misma información en otro lugar
   - Si no hay una ubicación obvia en los documentos del proyecto, pregunta antes de crear un nuevo archivo de nivel superior
5. **Commit** — Formato de commits convencionales, resúmenes completos en el PR

## Política de Superficie de Flujo de Trabajo

- `skills/` es la superficie canónica de flujo de trabajo.
- Las nuevas contribuciones de flujo de trabajo deben aterrizar en `skills/` primero.
- `commands/` es una superficie de compatibilidad de entradas slash heredada y solo debe añadirse o actualizarse cuando un shim siga siendo necesario para la migración o la paridad cross-harness.

## Flujo de Trabajo de Git

**Formato de commit:** `<tipo>: <descripción>` — Tipos: feat, fix, refactor, docs, test, chore, perf, ci

**Flujo de trabajo de PR:** Analiza el historial completo de commits → redacta un resumen completo → incluye plan de pruebas → push con flag `-u`.

## Patrones de Arquitectura

**Formato de respuesta de API:** Envelope consistente con indicador de éxito, payload de datos, mensaje de error y metadatos de paginación.

**Patrón repositorio:** Encapsula el acceso a datos detrás de una interfaz estándar (findAll, findById, create, update, delete). La lógica de negocio depende de la interfaz abstracta, no del mecanismo de almacenamiento.

**Proyectos esqueleto:** Busca plantillas probadas en batalla, evalúa con agentes paralelos (seguridad, extensibilidad, relevancia), clona la mejor coincidencia, itera dentro de la estructura probada.

## Rendimiento

**Gestión de contexto:** Evita el último 20% de la ventana de contexto para refactorizaciones grandes y features de múltiples archivos. Las tareas de menor sensibilidad (ediciones simples, docs, correcciones simples) toleran una mayor utilización.

**Solución de problemas de build:** Usa el agente build-error-resolver → analiza errores → corrige incrementalmente → verifica después de cada corrección.

## Estructura del Proyecto

```
agents/          — 63 subagentes especializados
skills/          — 249 skills de flujo de trabajo y conocimiento de dominio
commands/        — 79 comandos slash
hooks/           — Automatizaciones basadas en eventos
rules/           — Directrices de cumplimiento obligatorio (comunes + por lenguaje)
scripts/         — Utilidades Node.js multiplataforma
mcp-configs/     — 14 configuraciones de servidores MCP
tests/           — Suite de pruebas
```

`commands/` permanece en el repo por compatibilidad, pero la dirección a largo plazo es skills primero.

## Métricas de Éxito

- Todas las pruebas pasan con 80%+ de cobertura
- Sin vulnerabilidades de seguridad
- El código es legible y mantenible
- El rendimiento es aceptable
- Los requisitos del usuario están cumplidos
