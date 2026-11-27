---
description: Gestionar el historial de sesiones de Claude Code, alias y metadatos de sesión.
---

# Comando Sessions

Gestionar el historial de sesiones de Claude Code - listar, cargar, crear alias y editar sesiones almacenadas en `~/.claude/session-data/` con lecturas heredadas desde `~/.claude/sessions/`.

## Uso

`/sessions [list|load|alias|info|help] [opciones]`

## Acciones

### Listar Sesiones

Mostrar todas las sesiones con metadatos, filtrado y paginación.

```bash
/sessions                              # Listar todas las sesiones (por defecto)
/sessions list                         # Igual que el anterior
/sessions list --limit 10              # Mostrar 10 sesiones
/sessions list --date 2026-02-01       # Filtrar por fecha
/sessions list --search abc            # Buscar por ID de sesión
```

### Cargar Sesión

Cargar y mostrar el contenido de una sesión (por ID o alias).

```bash
/sessions load <id|alias>             # Cargar sesión
/sessions load 2026-02-01             # Por fecha (para sesiones sin ID)
/sessions load a1b2c3d4               # Por ID corto
/sessions load my-alias               # Por nombre de alias
```

### Crear Alias

Crear un alias memorable para una sesión.

```bash
/sessions alias <id> <nombre>           # Crear alias
/sessions alias 2026-02-01 hoy-trabajo  # Crear alias llamado "hoy-trabajo"
```

### Eliminar Alias

Eliminar un alias existente.

```bash
/sessions alias --remove <nombre>        # Eliminar alias
/sessions unalias <nombre>               # Igual que el anterior
```

### Información de Sesión

Mostrar información detallada sobre una sesión.

```bash
/sessions info <id|alias>              # Mostrar detalles de la sesión
```

### Listar Aliases

Mostrar todos los aliases de sesión.

```bash
/sessions aliases                      # Listar todos los aliases
```

## Notas del Operador

- Los archivos de sesión persisten `Project`, `Branch` y `Worktree` en el encabezado para que `/sessions info` pueda distinguir ejecuciones paralelas de tmux/worktree.
- Para monitoreo estilo command-center, combinar `/sessions info`, `git diff --stat` y las métricas de costo emitidas por `scripts/hooks/cost-tracker.js`.

## Argumentos

$ARGUMENTS:
- `list [opciones]` - Listar sesiones
  - `--limit <n>` - Máximo de sesiones a mostrar (por defecto: 50)
  - `--date <AAAA-MM-DD>` - Filtrar por fecha
  - `--search <patrón>` - Buscar en el ID de sesión
- `load <id|alias>` - Cargar contenido de sesión
- `alias <id> <nombre>` - Crear alias para la sesión
- `alias --remove <nombre>` - Eliminar alias
- `unalias <nombre>` - Igual que `--remove`
- `info <id|alias>` - Mostrar estadísticas de la sesión
- `aliases` - Listar todos los aliases
- `help` - Mostrar esta ayuda

## Ejemplos

```bash
# Listar todas las sesiones
/sessions list

# Crear un alias para la sesión de hoy
/sessions alias 2026-02-01 hoy

# Cargar sesión por alias
/sessions load hoy

# Mostrar información de la sesión
/sessions info hoy

# Eliminar alias
/sessions alias --remove hoy

# Listar todos los aliases
/sessions aliases
```

## Notas

- Las sesiones se almacenan como archivos markdown en `~/.claude/session-data/` con lecturas heredadas desde `~/.claude/sessions/`
- Los aliases se almacenan en `~/.claude/session-aliases.json`
- Los IDs de sesión pueden abreviarse (los primeros 4-8 caracteres suelen ser suficientemente únicos)
- Usar aliases para sesiones referenciadas frecuentemente
