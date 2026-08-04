# Flujo de Trabajo con Git

## Formato de Mensajes de Commit
```
<tipo>: <descripción>

<cuerpo opcional>
```

Tipos: feat, fix, refactor, docs, test, chore, perf, ci

Nota: Para desactivar la atribución de coautoría, configure `"includeCoAuthoredBy": false` en `~/.claude/settings.json`; Claude Code agrega `Co-Authored-By` de forma predeterminada y ECC no incluye esta configuración.

## Flujo de Trabajo de Pull Request

Al crear PRs:
1. Analizar el historial completo de commits (no solo el último commit)
2. Usar `git diff [base-branch]...HEAD` para ver todos los cambios
3. Redactar un resumen completo del PR
4. Incluir plan de pruebas con TODOs
5. Hacer push con la flag `-u` si es un branch nuevo

> Para el proceso completo de desarrollo (planificación, TDD, revisión de código) antes de las operaciones de git,
> ver [development-workflow.md](./development-workflow.md).
