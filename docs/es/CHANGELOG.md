# Registro de Cambios

## 2.0.0-rc.1 - 2026-04-28

### Destacados

- Añade la superficie pública del release candidate de ECC 2.0 para la historia del operador Hermes.
- Documenta ECC como el sustrato reutilizable cross-harness para Claude Code, Codex, Cursor, OpenCode y Gemini.
- Añade una superficie de skill de importación de Hermes sanitizada en lugar de publicar el estado del operador privado.

### Superficie de Lanzamiento

- Actualizados los metadatos de paquete, plugin, marketplace, OpenCode, agente y README a `2.0.0-rc.1`.
- Añadido `docs/releases/2.0.0-rc.1/` con notas de versión, borradores para redes sociales, lista de verificación de lanzamiento, notas de transferencia y prompts de demo.
- Añadido `docs/architecture/cross-harness.md` y cobertura de regresión para el límite ECC/Hermes.
- Mantenido el versionado de `ecc2/` independiente por ahora; sigue siendo un scaffold alfa del plano de control a menos que ingeniería de releases decida lo contrario.

### Notas

- Este es un release candidate, no una declaración GA para el roadmap completo del plano de control de ECC 2.0.
- La publicación npm de prerrelease debe usar el dist-tag `next` a menos que ingeniería de releases elija explícitamente lo contrario.

## 1.10.0 - 2026-04-05

### Destacados

- Superficie de lanzamiento público sincronizada con el repo en vivo tras varias semanas de crecimiento OSS y fusiones del backlog.
- Carril de flujos de trabajo de operador expandido con skills de voz, clasificación de grafos, facturación, espacio de trabajo y salida.
- Carril de generación de medios expandido con herramientas de lanzamiento basadas en Manim y Remotion.
- El binario del plano de control alfa de ECC 2.0 ya compila localmente desde `ecc2/` y expone la primera superficie de CLI/TUI utilizable.

### Superficie de Lanzamiento

- Actualizados los metadatos de plugin, marketplace, Codex, OpenCode y agente a `1.10.0`.
- Sincronizados los conteos publicados con la superficie OSS en vivo: 38 agentes, 156 skills, 72 comandos.
- Actualizados los documentos de instalación de nivel superior y las descripciones del marketplace para coincidir con el estado actual del repo.

### Nuevos Carriles de Flujo de Trabajo

- `brand-voice` — sistema de estilo de escritura derivado de fuentes canónicas.
- `social-graph-ranker` — primitiva de clasificación de grafos de introducción cálida ponderada.
- `connections-optimizer` — flujo de trabajo de poda/adición de redes sobre la clasificación de grafos.
- `customer-billing-ops`, `google-workspace-ops`, `project-flow-ops`, `workspace-surface-audit`.
- `manim-video`, `remotion-video-creation`, `nestjs-patterns`.

### ECC 2.0 Alpha

- `cargo build --manifest-path ecc2/Cargo.toml` pasa en la línea base del repositorio.
- `ecc-tui` actualmente expone `dashboard`, `start`, `sessions`, `status`, `stop`, `resume` y `daemon`.
- El alpha es real y utilizable para experimentación local, pero el roadmap más amplio del plano de control sigue incompleto y no debe tratarse como GA.

### Notas

- El plugin de Claude sigue limitado por las restricciones de distribución de reglas a nivel de plataforma; la ruta de instalación selectiva / OSS sigue siendo la instalación completa más confiable.
- Este lanzamiento es una corrección de la superficie del repo y una sincronización del ecosistema, no una declaración de que el roadmap completo de ECC 2.0 está completo.

## 1.9.0 - 2026-03-20

### Destacados

- Arquitectura de instalación selectiva con pipeline basado en manifiestos y almacén de estado SQLite.
- Cobertura de lenguajes expandida a más de 10 ecosistemas con 6 nuevos agentes y reglas específicas de lenguaje.
- Confiabilidad del observador reforzada con throttling de memoria, correcciones de sandbox y guardia de bucle de 5 capas.
- Base para skills auto-mejorables con evolución de skills y adaptadores de sesión.

### Nuevos Agentes

- `typescript-reviewer` — especialista en revisión de código TypeScript/JavaScript (#647)
- `pytorch-build-resolver` — resolución de errores de runtime, CUDA y entrenamiento de PyTorch (#549)
- `java-build-resolver` — resolución de errores de build de Maven/Gradle (#538)
- `java-reviewer` — revisión de código Java y Spring Boot (#528)
- `kotlin-reviewer` — revisión de código Kotlin/Android/KMP (#309)
- `kotlin-build-resolver` — errores de build en Kotlin/Gradle (#309)
- `rust-reviewer` — revisión de código Rust (#523)
- `rust-build-resolver` — resolución de errores de build en Rust (#523)
- `docs-lookup` — investigación de documentación y referencia de API (#529)

### Nuevas Skills

- `pytorch-patterns` — flujos de trabajo de aprendizaje profundo con PyTorch (#550)
- `documentation-lookup` — investigación de referencia de API y documentación de bibliotecas (#529)
- `bun-runtime` — patrones de runtime de Bun (#529)
- `nextjs-turbopack` — flujos de trabajo de Turbopack con Next.js (#529)
- `mcp-server-patterns` — patrones de diseño de servidores MCP (#531)
- `data-scraper-agent` — recopilación de datos públicos asistida por IA (#503)
- `team-builder` — skill de composición de equipos (#501)
- `ai-regression-testing` — flujos de trabajo de pruebas de regresión con IA (#433)
- `claude-devfleet` — orquestación multi-agente (#505)
- `blueprint` — planificación de construcción de múltiples sesiones
- `everything-claude-code` — skill autorreferencial de ECC (#335)
- `prompt-optimizer` — skill de optimización de prompts (#418)
- 8 skills de dominio operacional de Evos (#290)
- 3 skills de Laravel (#420)
- Skills de VideoDB (#301)

### Nuevos Comandos

- `/docs` — búsqueda de documentación (#530)
- `/aside` — conversación lateral (#407)
- `/prompt-optimize` — optimización de prompts (#418)
- `/resume-session`, `/save-session` — gestión de sesiones
- Mejoras de `learn-eval` con veredicto holístico basado en lista de verificación

### Nuevas Reglas

- Reglas de lenguaje Java (#645)
- Pack de reglas PHP (#389)
- Reglas y skills de lenguaje Perl (patrones, seguridad, pruebas)
- Reglas Kotlin/Android/KMP (#309)
- Soporte de lenguaje C++ (#539)
- Soporte de lenguaje Rust (#523)

### Infraestructura

- Arquitectura de instalación selectiva con resolución de manifiestos (`install-plan.js`, `install-apply.js`) (#509, #512)
- Almacén de estado SQLite con CLI de consultas para rastrear componentes instalados (#510)
- Adaptadores de sesión para grabación de sesiones estructurada (#511)
- Base para evolución de skills auto-mejorables (#514)
- Harness de orquestación con puntuación determinista (#524)
- Aplicación de conteos del catálogo en CI (#525)
- Validación del manifiesto de instalación para las 109 skills (#537)
- Wrapper del instalador de PowerShell (#532)
- Soporte para Antigravity IDE mediante flag `--target antigravity` (#332)
- Scripts de personalización de Codex CLI (#336)

### Correcciones de Errores

- Resueltos 19 fallos de pruebas de CI en 6 archivos (#519)
- Corregidos 8 fallos de pruebas en el pipeline de instalación, el orquestador y la reparación (#564)
- Explosión de memoria del observador con throttling, guardia de reentrada y muestreo de cola (#536)
- Corrección de acceso al sandbox del observador para invocación de Haiku (#661)
- Corrección de discrepancia de ID de proyecto en worktrees (#665)
- Lógica de inicio diferido del observador (#508)
- Guardia de prevención de bucle de 5 capas del observador (#399)
- Portabilidad de hooks y soporte de .cmd en Windows
- Optimización del hook de Biome — eliminada la sobrecarga de npx (#359)
- Hook de seguridad de InsAIts convertido en opt-in (#370)
- Corrección de exportación de spawnSync en Windows (#431)
- Corrección de codificación UTF-8 para la CLI de instintos (#353)
- Limpieza de secretos en hooks (#348)

### Traducciones

- Traducción al coreano (ko-KR) — README, agentes, comandos, skills, reglas (#392)
- Sincronización de documentación al chino (zh-CN) (#428)

### Créditos

- @ymdvsymd — correcciones de sandbox y worktrees del observador
- @pythonstrup — optimización del hook de Biome
- @Nomadu27 — hook de seguridad de InsAIts
- @hahmee — traducción al coreano
- @zdocapp — sincronización de documentación al chino
- @cookiee339 — ecosistema Kotlin
- @pangerlkr — correcciones del flujo de trabajo de CI
- @0xrohitgarg — skills de VideoDB
- @nocodemf — skills operacionales de Evos
- @swarnika-cmd — contribuciones comunitarias

## 1.8.0 - 2026-03-04

### Destacados

- Primer lanzamiento centrado en el harness, enfocado en confiabilidad, disciplina de evaluación y operaciones de bucles autónomos.
- El runtime de hooks ahora admite control basado en perfiles y deshabilitación selectiva de hooks.
- NanoClaw v2 añade enrutamiento de modelos, carga en caliente de skills, ramas, búsqueda, compactación, exportación y métricas.

### Núcleo

- Añadidos nuevos comandos: `/harness-audit`, `/loop-start`, `/loop-status`, `/quality-gate`, `/model-route`.
- Añadidas nuevas skills:
  - `agent-harness-construction`
  - `agentic-engineering`
  - `ralphinho-rfc-pipeline`
  - `ai-first-engineering`
  - `enterprise-agent-ops`
  - `nanoclaw-repl`
  - `continuous-agent-loop`
- Añadidos nuevos agentes:
  - `harness-optimizer`
  - `loop-operator`

### Confiabilidad de Hooks

- Corregida la resolución de raíz de SessionStart con búsqueda de fallback robusta.
- Movida la persistencia del resumen de sesión a `Stop` donde el payload del transcript está disponible.
- Añadidos hooks de quality-gate y cost-tracker.
- Reemplazados los frágiles one-liners de hook en línea por archivos de script dedicados.
- Añadidos controles `ECC_HOOK_PROFILE` y `ECC_DISABLED_HOOKS`.

### Multiplataforma

- Manejo de rutas seguro para Windows en la lógica de advertencia de documentos mejorado.
- Comportamiento del bucle del observador reforzado para evitar bloqueos no interactivos.

### Notas

- `autonomous-loops` se mantiene como alias de compatibilidad por un lanzamiento; `continuous-agent-loop` es el nombre canónico.

### Créditos

- inspirado por [zarazhangrui](https://github.com/zarazhangrui)
- homunculus inspirado por [humanplane](https://github.com/humanplane)
