# La Guía Extendida de Everything Claude Code

![Encabezado: La Guía Extendida de Everything Claude Code](../../assets/images/longform/01-header.png)

---

> **Prerequisito**: Esta guía se basa en [La Guía Breve de Everything Claude Code](./the-shortform-guide.md). Lee esa primero si aún no has configurado skills, hooks, subagentes, MCPs y plugins.

![Referencia a la Guía Breve](../../assets/images/longform/02-shortform-reference.png)
*La Guía Breve — léela primero*

En la guía breve cubrí la configuración fundamental: skills y comandos, hooks, subagentes, MCPs, plugins y los patrones de configuración que forman la columna vertebral de un flujo de trabajo efectivo en Claude Code. Eso era la guía de configuración y la infraestructura base.

Esta guía extendida profundiza en las técnicas que separan las sesiones productivas de las que desperdician recursos. Si no leíste la guía breve, vuelve y configura tus ajustes primero. Lo que sigue asume que ya tienes skills, agentes, hooks y MCPs configurados y funcionando.

Los temas aquí: economía de tokens, persistencia de memoria, patrones de verificación, estrategias de paralelización y los efectos compuestos de construir flujos de trabajo reutilizables. Estos son los patrones que he refinado en más de 10 meses de uso diario, y que marcan la diferencia entre sufrir una degradación de contexto en la primera hora versus mantener sesiones productivas durante horas.

Todo lo cubierto en las guías breve y extendida está disponible en GitHub: `github.com/affaan-m/everything-claude-code`

---

## Consejos y Trucos

### Algunos MCPs Son Reemplazables y Liberarán Tu Ventana de Contexto

Para MCPs como control de versiones (GitHub), bases de datos (Supabase), despliegue (Vercel, Railway), etc. — la mayoría de estas plataformas ya tienen CLIs robustas que el MCP básicamente solo envuelve. El MCP es un buen wrapper pero tiene un costo.

Para que la CLI funcione más como un MCP sin realmente usar el MCP (y la reducción de la ventana de contexto que conlleva), considera agrupar la funcionalidad en skills y comandos. Extrae las herramientas que el MCP expone para facilitar las cosas y conviértelas en comandos.

Ejemplo: en lugar de tener el MCP de GitHub cargado todo el tiempo, crea un comando `/gh-pr` que envuelva `gh pr create` con tus opciones preferidas. En lugar de que el MCP de Supabase consuma contexto, crea skills que usen el CLI de Supabase directamente.

Con la carga diferida (lazy loading), el problema de la ventana de contexto está en gran medida resuelto. Pero el uso de tokens y el costo no se resuelven de la misma manera. El enfoque de CLI + skills sigue siendo un método de optimización de tokens.

---

## LO IMPORTANTE

### Gestión de Contexto y Memoria

Para compartir memoria entre sesiones, la mejor opción es una skill o comando que resuma y verifique el progreso, luego lo guarde en un archivo `.tmp` en tu carpeta `.claude` y lo vaya añadiendo hasta el final de tu sesión. Al día siguiente puede usar eso como contexto y retomar donde lo dejaste; crea un nuevo archivo para cada sesión para no contaminar el contexto antiguo en el trabajo nuevo.

![Árbol de Archivos de Almacenamiento de Sesión](../../assets/images/longform/03-session-storage.png)
*Ejemplo de almacenamiento de sesión -> <https://github.com/affaan-m/everything-claude-code/tree/main/examples/sessions>*

Claude crea un archivo resumiendo el estado actual. Revísalo, pide ediciones si es necesario, luego empieza de nuevo. Para la nueva conversación, solo proporciona la ruta del archivo. Particularmente útil cuando estás alcanzando los límites de contexto y necesitas continuar trabajo complejo. Estos archivos deben contener:
- Qué enfoques funcionaron (verificablemente con evidencia)
- Qué enfoques se intentaron pero no funcionaron
- Qué enfoques no se han intentado y qué queda por hacer

**Limpiar el Contexto Estratégicamente:**

Una vez que tienes tu plan establecido y el contexto limpiado (opción predeterminada en el modo plan de Claude Code ahora), puedes trabajar desde el plan. Esto es útil cuando has acumulado mucho contexto de exploración que ya no es relevante para la ejecución. Para una compactación estratégica, deshabilita la compactación automática. Compacta manualmente en intervalos lógicos o crea una skill que lo haga por ti.

**Avanzado: Inyección Dinámica del System Prompt**

Un patrón que adopté: en lugar de poner todo en CLAUDE.md (alcance de usuario) o `.claude/rules/` (alcance de proyecto), que carga en cada sesión, usa flags de CLI para inyectar contexto dinámicamente.

```bash
claude --system-prompt "$(cat memory.md)"
```

Esto te permite ser más quirúrgico sobre qué contexto se carga y cuándo. El contenido del system prompt tiene mayor autoridad que los mensajes del usuario, que tienen mayor autoridad que los resultados de herramientas.

**Configuración práctica:**

```bash
# Desarrollo diario
alias claude-dev='claude --system-prompt "$(cat ~/.claude/contexts/dev.md)"'

# Modo de revisión de PR
alias claude-review='claude --system-prompt "$(cat ~/.claude/contexts/review.md)"'

# Modo de investigación/exploración
alias claude-research='claude --system-prompt "$(cat ~/.claude/contexts/research.md)"'
```

**Avanzado: Hooks de Persistencia de Memoria**

Hay hooks que la mayoría de la gente no conoce y que ayudan con la memoria:

- **Hook PreCompact**: Antes de que ocurra la compactación del contexto, guarda el estado importante en un archivo
- **Hook Stop (Fin de Sesión)**: Al finalizar la sesión, persiste los aprendizajes en un archivo
- **Hook SessionStart**: Al iniciar una nueva sesión, carga el contexto previo automáticamente

He construido estos hooks y están en el repositorio en `github.com/affaan-m/everything-claude-code/tree/main/hooks/memory-persistence`

---

### Aprendizaje Continuo / Memoria

Si has tenido que repetir un prompt varias veces y Claude se encontró con el mismo problema o te dio una respuesta que ya habías escuchado antes — esos patrones deben añadirse a las skills.

**El Problema:** Tokens desperdiciados, contexto desperdiciado, tiempo desperdiciado.

**La Solución:** Cuando Claude Code descubre algo que no es trivial — una técnica de depuración, una solución alternativa, algún patrón específico del proyecto — guarda ese conocimiento como una nueva skill. La próxima vez que aparezca un problema similar, la skill se carga automáticamente.

He construido una skill de aprendizaje continuo que hace esto: `github.com/affaan-m/everything-claude-code/tree/main/skills/continuous-learning`

**Por Qué Hook Stop (No UserPromptSubmit):**

La decisión de diseño clave es usar un **hook Stop** en lugar de UserPromptSubmit. UserPromptSubmit se ejecuta en cada mensaje — añade latencia a cada prompt. Stop se ejecuta una vez al final de la sesión — es ligero, no te ralentiza durante la sesión.

---

### Optimización de Tokens

**Estrategia Principal: Arquitectura de Subagentes**

Optimiza las herramientas que usas y la arquitectura de subagentes diseñada para delegar al modelo más económico posible que sea suficiente para la tarea.

**Referencia Rápida de Selección de Modelos:**

![Tabla de Selección de Modelos](../../assets/images/longform/04-model-selection.png)
*Configuración hipotética de subagentes en diversas tareas comunes y razonamiento detrás de las elecciones*

| Tipo de Tarea             | Modelo | Por qué                                          |
| ------------------------- | ------ | ------------------------------------------------ |
| Exploración/búsqueda      | Haiku  | Rápido, económico, suficiente para encontrar archivos |
| Ediciones simples         | Haiku  | Cambios en un solo archivo, instrucciones claras |
| Implementación multi-archivo | Sonnet | Mejor balance para codificación               |
| Arquitectura compleja     | Opus   | Se necesita razonamiento profundo               |
| Revisiones de PR          | Sonnet | Entiende el contexto, capta los matices         |
| Análisis de seguridad     | Opus   | No se puede permitir pasar por alto vulnerabilidades |
| Escribir documentación    | Haiku  | La estructura es simple                         |
| Depurar errores complejos | Opus   | Necesita tener todo el sistema en mente         |

Usa Sonnet de manera predeterminada para el 90% de las tareas de codificación. Actualiza a Opus cuando el primer intento falló, la tarea abarca 5+ archivos, para decisiones arquitectónicas, o código crítico para la seguridad.

**Referencia de Precios:**

![Precios de Modelos Claude](../../assets/images/longform/05-pricing-table.png)
*Fuente: <https://platform.claude.com/docs/en/about-claude/pricing>*

**Optimizaciones Específicas de Herramientas:**

Reemplaza grep con mgrep — ~50% de reducción de tokens en promedio comparado con grep o ripgrep tradicionales:

![Benchmark de mgrep](../../assets/images/longform/06-mgrep-benchmark.png)
*En nuestro benchmark de 50 tareas, mgrep + Claude Code usó ~2x menos tokens que los flujos de trabajo basados en grep con calidad similar o mejor. Fuente: mgrep by @mixedbread-ai*

**Beneficios de una Base de Código Modular:**

Tener una base de código más modular con archivos principales de cientos de líneas en lugar de miles ayuda tanto en los costos de optimización de tokens como en completar una tarea correctamente en el primer intento.

---

### Bucles de Verificación y Evaluaciones

**Flujo de Trabajo de Benchmarking:**

Compara pedir lo mismo con y sin una skill y verificar la diferencia en el resultado:

Haz un fork de la conversación, inicia un nuevo worktree en uno de ellos sin la skill, muestra un diff al final, observa qué se registró.

**Tipos de Patrones de Evaluación:**

- **Evaluaciones Basadas en Checkpoints**: Establece checkpoints explícitos, verifica contra criterios definidos, corrige antes de continuar
- **Evaluaciones Continuas**: Ejecuta cada N minutos o después de cambios importantes, suite completa de pruebas + lint

**Métricas Clave:**

```
pass@k: AL MENOS UNO de k intentos tiene éxito
        k=1: 70%  k=3: 91%  k=5: 97%

pass^k: TODOS los k intentos deben tener éxito
        k=1: 70%  k=3: 34%  k=5: 17%
```

Usa **pass@k** cuando solo necesitas que funcione. Usa **pass^k** cuando la consistencia es esencial.

---

## PARALELIZACIÓN

Cuando hagas fork de conversaciones en una configuración de terminal multi-Claude, asegúrate de que el alcance esté bien definido para las acciones en el fork y en la conversación original. Busca la mínima superposición cuando se trate de cambios en el código.

**Mi Patrón Preferido:**

Chat principal para cambios de código, forks para preguntas sobre la base de código y su estado actual, o investigación sobre servicios externos.

**Sobre Cantidades Arbitrarias de Terminales:**

![Boris sobre Terminales en Paralelo](../../assets/images/longform/07-boris-parallel.png)
*Boris (Anthropic) sobre ejecutar múltiples instancias de Claude*

Boris tiene consejos sobre paralelización. Ha sugerido cosas como ejecutar 5 instancias de Claude localmente y 5 en upstream. Desaconsejo establecer cantidades arbitrarias de terminales. La adición de un terminal debe surgir de una verdadera necesidad.

Tu objetivo debe ser: **cuánto puedes lograr con la cantidad mínima viable de paralelización.**

**Git Worktrees para Instancias en Paralelo:**

```bash
# Crear worktrees para trabajo en paralelo
git worktree add ../project-feature-a feature-a
git worktree add ../project-feature-b feature-b
git worktree add ../project-refactor refactor-branch

# Cada worktree obtiene su propia instancia de Claude
cd ../project-feature-a && claude
```

SI vas a escalar tus instancias Y tienes múltiples instancias de Claude trabajando en código que se superpone entre sí, es imprescindible que uses git worktrees y tengas un plan muy bien definido para cada uno. Usa `/rename <nombre>` para nombrar todos tus chats.

![Configuración de Dos Terminales](../../assets/images/longform/08-two-terminals.png)
*Configuración Inicial: Terminal Izquierda para Codificar, Terminal Derecha para Preguntas — usa /rename y /fork*

**El Método Cascada:**

Al ejecutar múltiples instancias de Claude Code, organízate con un patrón de "cascada":

- Abre nuevas tareas en nuevas pestañas a la derecha
- Barre de izquierda a derecha, de más antiguo a más nuevo
- Enfócate en como máximo 3-4 tareas a la vez

---

## TRABAJO PREVIO

**El Patrón de Inicio con Dos Instancias:**

Para mi propia gestión de flujo de trabajo, me gusta empezar un repositorio vacío con 2 instancias de Claude abiertas.

**Instancia 1: Agente de Scaffolding**
- Establece el scaffold y el trabajo previo
- Crea la estructura del proyecto
- Configura las configs (CLAUDE.md, reglas, agentes)

**Instancia 2: Agente de Investigación Profunda**
- Se conecta a todos tus servicios, búsqueda web
- Crea el PRD detallado
- Crea diagramas de arquitectura en Mermaid
- Compila las referencias con fragmentos de documentación reales

**Patrón llms.txt:**

Si está disponible, puedes encontrar un `llms.txt` en muchas referencias de documentación haciendo `/llms.txt` en ellas una vez que llegues a su página de documentación. Esto te da una versión limpia y optimizada para LLM de la documentación.

**Filosofía: Construir Patrones Reutilizables**

De @omarsar0: "Al principio, dediqué tiempo a construir flujos de trabajo/patrones reutilizables. Tedioso de construir, pero tuvo un efecto compuesto enorme a medida que los modelos y los harnesses de agentes mejoraron."

**En qué invertir:**

- Subagentes
- Skills
- Comandos
- Patrones de planificación
- Herramientas MCP
- Patrones de ingeniería de contexto

---

## Mejores Prácticas para Agentes y Subagentes

**El Problema de Contexto de los Subagentes:**

Los subagentes existen para ahorrar contexto devolviendo resúmenes en lugar de volcarlo todo. Pero el orquestador tiene contexto semántico que el subagente no tiene. El subagente solo conoce la consulta literal, no el PROPÓSITO detrás de la solicitud.

**Patrón de Recuperación Iterativa:**

1. El orquestador evalúa cada respuesta del subagente
2. Haz preguntas de seguimiento antes de aceptarla
3. El subagente vuelve a la fuente, obtiene respuestas, devuelve
4. Repite hasta que sea suficiente (máximo 3 ciclos)

**Clave:** Pasa contexto objetivo, no solo la consulta.

**Orquestador con Fases Secuenciales:**

```markdown
Fase 1: INVESTIGACIÓN (usa agente Explore) → research-summary.md
Fase 2: PLANIFICACIÓN (usa agente planner) → plan.md
Fase 3: IMPLEMENTACIÓN (usa agente tdd-guide) → cambios en el código
Fase 4: REVISIÓN (usa agente code-reviewer) → review-comments.md
Fase 5: VERIFICACIÓN (usa build-error-resolver si es necesario) → terminado o vuelve al inicio
```

**Reglas clave:**

1. Cada agente recibe UNA entrada clara y produce UNA salida clara
2. Las salidas se convierten en entradas para la siguiente fase
3. Nunca omitas fases
4. Usa `/clear` entre agentes
5. Almacena las salidas intermedias en archivos

---

## COSAS DIVERTIDAS / NO CRÍTICAS, SOLO CONSEJOS DIVERTIDOS

### Línea de Estado Personalizada

Puedes configurarla usando `/statusline` — luego Claude dirá que no tienes una pero puede configurarla por ti y te preguntará qué quieres en ella.

Ver también: ccstatusline (proyecto comunitario para líneas de estado personalizadas de Claude Code)

### Transcripción por Voz

Habla con Claude Code con tu voz. Más rápido que escribir para mucha gente.

- superwhisper, MacWhisper en Mac
- Incluso con errores de transcripción, Claude entiende la intención

### Alias de Terminal

```bash
alias c='claude'
alias gb='github'
alias co='code'
alias q='cd ~/Desktop/projects'
```

---

## Hito

![25k+ Estrellas en GitHub](../../assets/images/longform/09-25k-stars.png)
*25,000+ estrellas en GitHub en menos de una semana*

---

## Recursos

**Orquestación de Agentes:**

- claude-flow — Plataforma de orquestación empresarial construida por la comunidad con 54+ agentes especializados

**Memoria Auto-Mejorable:**

- Ver `skills/continuous-learning/` en este repositorio
- rlancemartin.github.io/2025/12/01/claude_diary/ — Patrón de reflexión de sesión

**Referencia de System Prompts:**

- system-prompts-and-models-of-ai-tools — Colección comunitaria de system prompts de IA (110k+ estrellas)

**Oficial:**

- Anthropic Academy: anthropic.skilljar.com

---

## Referencias

- [Anthropic: Desmitificando las evaluaciones para agentes de IA](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [YK: 32 Consejos de Claude Code](https://agenticcoding.substack.com/p/32-claude-code-tips-from-basics-to)
- [RLanceMartin: Patrón de Reflexión de Sesión](https://rlancemartin.github.io/2025/12/01/claude_diary/)
- @PerceptualPeak: Negociación de Contexto de Subagentes
- @menhguin: Tierlist de Abstracciones de Agentes
- @omarsar0: Filosofía de Efectos Compuestos

---

*Todo lo cubierto en ambas guías está disponible en GitHub en [everything-claude-code](https://github.com/affaan-m/everything-claude-code)*
