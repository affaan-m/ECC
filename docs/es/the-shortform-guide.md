# La Guía Resumida de Everything Claude Code

![Encabezado: Ganador del Hackathon de Anthropic - Tips y Trucos para Claude Code](../../assets/images/shortform/00-header.png)

---

**Soy usuario activo de Claude Code desde el lanzamiento experimental en febrero, y gané el hackathon de Anthropic x Forum Ventures con [zenith.chat](https://zenith.chat) junto a [@DRodriguezFX](https://x.com/DRodriguezFX) — usando Claude Code por completo.**

Aquí está mi configuración completa tras 10 meses de uso diario: skills, hooks, subagentes, MCPs, plugins y lo que realmente funciona.

---

## Skills y Comandos

Las skills son la superficie principal de flujo de trabajo. Actúan como paquetes de flujo de trabajo con alcance definido: prompts reutilizables, estructura, archivos de soporte y codemaps cuando necesitas un patrón de ejecución específico.

Después de una sesión larga de codificación con Opus 4.5, ¿quieres limpiar código muerto y archivos .md sueltos? Ejecuta `/refactor-clean`. ¿Necesitas pruebas? `/tdd`, `/e2e`, `/test-coverage`. Esas entradas slash son convenientes, pero la unidad duradera real es la skill subyacente. Las skills también pueden incluir codemaps — una forma para que Claude navegue rápidamente tu código base sin quemar contexto en exploración.

![Terminal mostrando comandos encadenados](../../assets/images/shortform/02-chaining-commands.jpeg)
*Encadenando comandos juntos*

ECC sigue enviando una capa `commands/`, pero es mejor pensarla como compatibilidad de entradas slash heredadas durante la migración. La lógica duradera debe vivir en las skills.

- **Skills**: `~/.claude/skills/` - definiciones canónicas de flujos de trabajo
- **Commands**: `~/.claude/commands/` - shims de entradas slash heredadas cuando aún los necesitas

```bash
# Estructura de skill de ejemplo
~/.claude/skills/
  pmx-guidelines.md      # Patrones específicos del proyecto
  coding-standards.md    # Mejores prácticas por lenguaje
  tdd-workflow/          # Skill multi-archivo con SKILL.md
  security-review/       # Skill basada en lista de verificación
```

---

## Hooks

Los hooks son automatizaciones basadas en eventos que se disparan en eventos específicos. A diferencia de las skills, están restringidos a llamadas de herramientas y eventos del ciclo de vida.

**Tipos de Hook:**

1. **PreToolUse** - Antes de que ejecute una herramienta (validación, recordatorios)
2. **PostToolUse** - Después de que termina una herramienta (formateo, bucles de retroalimentación)
3. **UserPromptSubmit** - Cuando envías un mensaje
4. **Stop** - Cuando Claude termina de responder
5. **PreCompact** - Antes de la compactación del contexto
6. **Notification** - Solicitudes de permisos

**Ejemplo: recordatorio de tmux antes de comandos de larga ejecución**

```json
{
  "PreToolUse": [
    {
      "matcher": "tool == \"Bash\" && tool_input.command matches \"(npm|pnpm|yarn|cargo|pytest)\"",
      "hooks": [
        {
          "type": "command",
          "command": "if [ -z \"$TMUX\" ]; then echo '[Hook] Considera tmux para persistencia de sesión' >&2; fi"
        }
      ]
    }
  ]
}
```

![Retroalimentación de hook PostToolUse](../../assets/images/shortform/03-posttooluse-hook.png)
*Ejemplo de la retroalimentación que recibes en Claude Code al ejecutar un hook PostToolUse*

**Consejo profesional:** Usa el plugin `hookify` para crear hooks de forma conversacional en lugar de escribir JSON manualmente. Ejecuta `/hookify` y describe lo que quieres.

---

## Subagentes

Los subagentes son procesos a los que tu orquestador (Claude principal) puede delegar tareas con alcances limitados. Pueden ejecutarse en segundo plano o en primer plano, liberando contexto para el agente principal.

Los subagentes funcionan bien con las skills — un subagente capaz de ejecutar un subconjunto de tus skills puede recibir tareas delegadas y usar esas skills de forma autónoma. También pueden ser aislados con permisos específicos de herramientas.

```bash
# Estructura de subagente de ejemplo
~/.claude/agents/
  planner.md           # Planificación de implementación de features
  architect.md         # Decisiones de diseño del sistema
  tdd-guide.md         # Desarrollo guiado por pruebas
  code-reviewer.md     # Revisión de calidad/seguridad
  security-reviewer.md # Análisis de vulnerabilidades
  build-error-resolver.md
  e2e-runner.md
  refactor-cleaner.md
```

Configura las herramientas, MCPs y permisos permitidos por subagente para un alcance adecuado.

---

## Reglas y Memoria

Tu carpeta `.rules` contiene archivos `.md` con las mejores prácticas que Claude SIEMPRE debe seguir. Dos enfoques:

1. **CLAUDE.md único** - Todo en un archivo (nivel de usuario o proyecto)
2. **Carpeta de reglas** - Archivos `.md` modulares agrupados por preocupación

```bash
~/.claude/rules/
  security.md      # Sin secretos codificados, valida entradas
  coding-style.md  # Inmutabilidad, organización de archivos
  testing.md       # Flujo de trabajo TDD, 80% de cobertura
  git-workflow.md  # Formato de commit, proceso de PR
  agents.md        # Cuándo delegar a subagentes
  performance.md   # Selección de modelos, gestión del contexto
```

**Reglas de ejemplo:**

- Sin emojis en el código base
- Evitar tonos morados en el frontend
- Siempre probar el código antes del despliegue
- Priorizar código modular sobre mega-archivos
- Nunca confirmar console.logs

---

## MCPs (Protocolo de Contexto de Modelos)

Los MCPs conectan Claude a servicios externos directamente. No son un reemplazo para las APIs — son un wrapper orientado a prompts alrededor de ellas, que permite más flexibilidad para navegar información.

**Ejemplo:** El MCP de Supabase permite a Claude obtener datos específicos, ejecutar SQL directamente en origen sin copiar y pegar. Lo mismo para bases de datos, plataformas de despliegue, etc.

![MCP de Supabase listando tablas](../../assets/images/shortform/04-supabase-mcp.jpeg)
*Ejemplo del MCP de Supabase listando las tablas dentro del schema público*

**Chrome en Claude:** es un plugin MCP integrado que permite a Claude controlar autónomamente tu navegador — haciendo clic para ver cómo funcionan las cosas.

**CRÍTICO: Gestión de la Ventana de Contexto**

Sé selectivo con los MCPs. Mantengo todos los MCPs en la configuración del usuario pero **deshabilito todo lo que no uso**. Navega a `/plugins` y desplázate hacia abajo o ejecuta `/mcp`.

![Interfaz de /plugins](../../assets/images/shortform/05-plugins-interface.jpeg)
*Usando /plugins para navegar a los MCPs y ver cuáles están instalados actualmente y su estado*

Tu ventana de contexto de 200k antes de compactar podría ser solo 70k con demasiadas herramientas habilitadas. El rendimiento se degrada significativamente.

**Regla general:** Ten 20-30 MCPs en la configuración, pero mantén menos de 10 habilitados / menos de 80 herramientas activas.

```bash
# Ver MCPs habilitados
/mcp

# Deshabilitar los no usados en ~/.claude/settings.json o en el .mcp.json del repo actual
```

---

## Plugins

Los plugins empaquetan herramientas para una instalación fácil en lugar de una configuración manual tediosa. Un plugin puede ser una skill + MCP combinados, o hooks/herramientas empaquetados juntos.

**Instalando plugins:**

```bash
# Añadir un marketplace
# plugin mgrep de @mixedbread-ai
claude plugin marketplace add https://github.com/mixedbread-ai/mgrep

# Abre Claude, ejecuta /plugins, encuentra el nuevo marketplace, instala desde ahí
```

![Pestaña de Marketplaces mostrando mgrep](../../assets/images/shortform/06-marketplaces-mgrep.jpeg)
*Mostrando el marketplace de Mixedbread-Grep recién instalado*

**Los Plugins LSP** son particularmente útiles si ejecutas Claude Code fuera de editores con frecuencia. El Protocolo de Servidor de Lenguaje da a Claude verificación de tipos en tiempo real, ir a la definición y completado inteligente sin necesitar un IDE abierto.

```bash
# Ejemplo de plugins habilitados
typescript-lsp@claude-plugins-official  # Inteligencia TypeScript
pyright-lsp@claude-plugins-official     # Verificación de tipos Python
hookify@claude-plugins-official         # Crear hooks conversacionalmente
mgrep@Mixedbread-Grep                   # Mejor búsqueda que ripgrep
```

Misma advertencia que los MCPs — vigila tu ventana de contexto.

---

## Tips y Trucos

### Atajos de Teclado

- `Ctrl+U` - Borrar línea completa (más rápido que spam de retroceso)
- `!` - Prefijo rápido de comando bash
- `@` - Buscar archivos
- `/` - Iniciar comandos slash
- `Shift+Enter` - Entrada multilínea
- `Tab` - Alternar visualización del pensamiento
- `Esc Esc` - Interrumpir a Claude / restaurar código

### Flujos de Trabajo Paralelos

- **Fork** (`/fork`) - Bifurca conversaciones para hacer tareas no superpuestas en paralelo en lugar de enviar mensajes en cola
- **Git Worktrees** - Para Claudes paralelos superpuestos sin conflictos. Cada worktree es un checkout independiente

```bash
git worktree add ../feature-branch feature-branch
# Ahora ejecuta instancias separadas de Claude en cada worktree
```

### tmux para Comandos de Larga Ejecución

Haz streaming y observa los logs/procesos bash que ejecuta Claude:

```bash
tmux new -s dev
# Claude ejecuta comandos aquí, puedes desconectarte y volver a conectarte
tmux attach -t dev
```

### mgrep > grep

`mgrep` es una mejora significativa de ripgrep/grep. Instala mediante el marketplace de plugins, luego usa la skill `/mgrep`. Funciona con búsqueda local y web.

```bash
mgrep "function handleSubmit"  # Búsqueda local
mgrep --web "Next.js 15 app router changes"  # Búsqueda web
```

### Otros Comandos Útiles

- `/rewind` - Volver a un estado anterior
- `/statusline` - Personalizar con rama, % de contexto, todos
- `/checkpoints` - Puntos de deshacer a nivel de archivo
- `/compact` - Activar manualmente la compactación del contexto

### CI/CD con GitHub Actions

Configura revisiones de código en tus PRs con GitHub Actions. Claude puede revisar PRs automáticamente cuando se configura.

![Bot de Claude aprobando un PR](../../assets/images/shortform/08-github-pr-review.jpeg)
*Claude aprobando un PR de corrección de bug*

### Sandboxing

Usa el modo sandbox para operaciones arriesgadas — Claude se ejecuta en un entorno restringido sin afectar tu sistema real.

---

## Sobre los Editores

Tu elección de editor impacta significativamente el flujo de trabajo con Claude Code. Si bien Claude Code funciona desde cualquier terminal, emparejarlo con un editor capaz desbloquea el seguimiento de archivos en tiempo real, navegación rápida y ejecución integrada de comandos.

### Zed (Mi Preferencia)

Uso [Zed](https://zed.dev) — escrito en Rust, por lo que es genuinamente rápido. Abre al instante, maneja bases de código masivas sin sudar, y apenas toca los recursos del sistema.

**Por qué Zed + Claude Code es una gran combinación:**

- **Velocidad** - El rendimiento basado en Rust significa sin lag cuando Claude está editando archivos rápidamente. Tu editor se mantiene al día
- **Integración del Panel de Agentes** - La integración Claude de Zed te permite rastrear cambios de archivos en tiempo real mientras Claude edita. Salta entre archivos que Claude referencia sin salir del editor
- **Paleta de Comandos CMD+Shift+R** - Acceso rápido a todos tus comandos slash personalizados, depuradores, scripts de build en una UI con búsqueda
- **Uso Mínimo de Recursos** - No competirá con Claude por RAM/CPU durante operaciones pesadas. Importante cuando ejecutas Opus
- **Modo Vim** - Keybindings completos de vim si es lo tuyo

![Editor Zed con comandos personalizados](../../assets/images/shortform/09-zed-editor.jpeg)
*Editor Zed con desplegable de comandos personalizados usando CMD+Shift+R. Modo de seguimiento mostrado como la diana en la esquina inferior derecha.*

**Consejos Agnósticos al Editor:**

1. **Divide tu pantalla** - Terminal con Claude Code a un lado, editor al otro
2. **Ctrl + G** - abre rápidamente el archivo en el que Claude está trabajando en Zed
3. **Auto-guardado** - Habilita el guardado automático para que las lecturas de archivos de Claude siempre sean actuales
4. **Integración git** - Usa las funciones git del editor para revisar los cambios de Claude antes de confirmarlos
5. **Observadores de archivos** - La mayoría de los editores recargan automáticamente los archivos modificados, verifica que esté habilitado

### VSCode / Cursor

También es una opción viable y funciona bien con Claude Code. Puedes usarlo en formato de terminal, con sincronización automática con tu editor usando `\ide` habilitando funcionalidad LSP (algo redundante con los plugins ahora). O puedes optar por la extensión que está más integrada con el editor y tiene una UI a juego.

![Extensión de VS Code para Claude Code](../../assets/images/shortform/10-vscode-extension.jpeg)
*La extensión de VS Code proporciona una interfaz gráfica nativa para Claude Code, integrada directamente en tu IDE.*

---

## Mi Configuración

### Plugins

**Instalados:** (normalmente solo tengo 4-5 de estos habilitados a la vez)

```markdown
ralph-wiggum@claude-code-plugins       # Automatización de bucles
frontend-patterns@claude-code-plugins  # Patrones UI/UX
commit-commands@claude-code-plugins    # Flujo de trabajo de git
security-guidance@claude-code-plugins  # Verificaciones de seguridad
pr-review-toolkit@claude-code-plugins  # Automatización de PRs
typescript-lsp@claude-plugins-official # Inteligencia TypeScript
hookify@claude-plugins-official        # Creación de hooks
code-simplifier@claude-plugins-official
feature-dev@claude-code-plugins
explanatory-output-style@claude-code-plugins
code-review@claude-code-plugins
context7@claude-plugins-official       # Documentación en vivo
pyright-lsp@claude-plugins-official    # Tipos Python
mgrep@Mixedbread-Grep                  # Mejor búsqueda
```

### Servidores MCP

**Configurados (Nivel de Usuario):**

```json
{
  "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
  "firecrawl": { "command": "npx", "args": ["-y", "firecrawl-mcp"] },
  "supabase": {
    "command": "npx",
    "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=YOUR_REF"]
  },
  "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] },
  "sequential-thinking": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
  },
  "vercel": { "type": "http", "url": "https://mcp.vercel.com" },
  "railway": { "command": "npx", "args": ["-y", "@railway/mcp-server"] },
  "cloudflare-docs": { "type": "http", "url": "https://docs.mcp.cloudflare.com/mcp" },
  "cloudflare-workers-bindings": {
    "type": "http",
    "url": "https://bindings.mcp.cloudflare.com/mcp"
  },
  "clickhouse": { "type": "http", "url": "https://mcp.clickhouse.cloud/mcp" },
  "AbletonMCP": { "command": "uvx", "args": ["ableton-mcp"] },
  "magic": { "command": "npx", "args": ["-y", "@magicuidesign/mcp@latest"] }
}
```

Esta es la clave — tengo 14 MCPs configurados pero solo ~5-6 habilitados por proyecto. Mantiene la ventana de contexto saludable.

### Hooks Clave

```json
{
  "PreToolUse": [
    { "matcher": "npm|pnpm|yarn|cargo|pytest", "hooks": ["recordatorio de tmux"] },
    { "matcher": "Write && .md file", "hooks": ["bloquear a menos que sea README/CLAUDE"] },
    { "matcher": "git push", "hooks": ["abrir editor para revisión"] }
  ],
  "PostToolUse": [
    { "matcher": "Edit && .ts/.tsx/.js/.jsx", "hooks": ["prettier --write"] },
    { "matcher": "Edit && .ts/.tsx", "hooks": ["tsc --noEmit"] },
    { "matcher": "Edit", "hooks": ["advertencia de console.log"] }
  ],
  "Stop": [
    { "matcher": "*", "hooks": ["verificar archivos modificados por console.log"] }
  ]
}
```

### Línea de Estado Personalizada

Muestra usuario, directorio, rama de git con indicador de modificaciones, % de contexto restante, modelo, hora y conteo de todos:

![Línea de estado personalizada](../../assets/images/shortform/11-statusline.jpeg)
*Ejemplo de statusline en mi directorio raíz de Mac*

```
affoon:~ ctx:65% Opus 4.5 19:52
▌▌ plan mode on (shift+tab to cycle)
```

### Estructura de Reglas

```
~/.claude/rules/
  security.md      # Verificaciones de seguridad obligatorias
  coding-style.md  # Inmutabilidad, límites de tamaño de archivos
  testing.md       # TDD, 80% de cobertura
  git-workflow.md  # Commits convencionales
  agents.md        # Reglas de delegación a subagentes
  patterns.md      # Formatos de respuesta de API
  performance.md   # Selección de modelos (Haiku vs Sonnet vs Opus)
  hooks.md         # Documentación de hooks
```

### Subagentes

```
~/.claude/agents/
  planner.md           # Descomponer features
  architect.md         # Diseño del sistema
  tdd-guide.md         # Escribir pruebas primero
  code-reviewer.md     # Revisión de calidad
  security-reviewer.md # Análisis de vulnerabilidades
  build-error-resolver.md
  e2e-runner.md        # Pruebas con Playwright
  refactor-cleaner.md  # Eliminación de código muerto
  doc-updater.md       # Mantener los docs sincronizados
```

---

## Conclusiones Clave

1. **No compliques en exceso** - trata la configuración como ajuste fino, no como arquitectura
2. **La ventana de contexto es valiosa** - deshabilita MCPs y plugins no usados
3. **Ejecución paralela** - bifurca conversaciones, usa git worktrees
4. **Automatiza lo repetitivo** - hooks para formateo, linting, recordatorios
5. **Delimita el alcance de tus subagentes** - herramientas limitadas = ejecución enfocada

---

## Referencias

- [Referencia de Plugins](https://code.claude.com/docs/en/plugins-reference)
- [Documentación de Hooks](https://code.claude.com/docs/en/hooks)
- [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- [Modo Interactivo](https://code.claude.com/docs/en/interactive-mode)
- [Sistema de Memoria](https://code.claude.com/docs/en/memory)
- [Subagentes](https://code.claude.com/docs/en/sub-agents)
- [Descripción General de MCP](https://code.claude.com/docs/en/mcp-overview)

---

**Nota:** Este es un subconjunto de los detalles. Consulta la [Guía Extensa](./the-longform-guide.md) para patrones avanzados.

---

*Gané el hackathon de Anthropic x Forum Ventures en Nueva York construyendo [zenith.chat](https://zenith.chat) con [@DRodriguezFX](https://x.com/DRodriguezFX)*
