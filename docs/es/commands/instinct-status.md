---
name: instinct-status
description: Mostrar los instintos aprendidos (proyecto + global) con confianza
command: true
---

# Comando Instinct Status

Muestra los instintos aprendidos para el proyecto actual más los instintos globales, agrupados por dominio.

## Implementación

Ejecutar la CLI de instintos usando la ruta raíz del plugin:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" status
```

O si `CLAUDE_PLUGIN_ROOT` no está configurado (instalación manual):

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py status
```

## Uso

```
/instinct-status
```

## Qué Hacer

1. Detectar el contexto actual del proyecto (hash de remote/ruta de git)
2. Leer instintos del proyecto desde `~/.claude/homunculus/projects/<project-id>/instincts/`
3. Leer instintos globales desde `~/.claude/homunculus/instincts/`
4. Fusionar con reglas de precedencia (el proyecto sobreescribe global cuando hay colisión de IDs)
5. Mostrar agrupados por dominio con barras de confianza y estadísticas de observación

## Formato de Salida

```
============================================================
  ESTADO DE INSTINTOS - 12 en total
============================================================

  Proyecto: my-app (a1b2c3d4e5f6)
  Instintos del proyecto: 8
  Instintos globales:     4

## CON ALCANCE DE PROYECTO (my-app)
  ### WORKFLOW (3)
    ███████░░░  70%  grep-before-edit [proyecto]
              disparador: when modifying code

## GLOBAL (aplican a todos los proyectos)
  ### SECURITY (2)
    █████████░  85%  validate-user-input [global]
              disparador: when handling user input
```
