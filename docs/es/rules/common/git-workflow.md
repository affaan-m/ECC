# Flujo de Trabajo con Git

## Formato de Mensajes de Commit
```
<tipo>: <descripción>

<cuerpo opcional>
```

Tipos: feat, fix, refactor, docs, test, chore, perf, ci

Nota: Las instalaciones gestionadas por ECC configuran `"includeCoAuthoredBy": false` en `~/.claude/settings.json`, por lo que los commits no incluyen `Co-Authored-By` de forma predeterminada. Para conservar la atribución de Claude, configure `"includeCoAuthoredBy": true` o `attribution`; ECC nunca sobrescribe una elección explícita.

## Flujo de Trabajo de Pull Request

Al crear PRs:
1. Analizar el historial completo de commits (no solo el último commit)
2. Usar `git diff [base-branch]...HEAD` para ver todos los cambios
3. Redactar un resumen completo del PR
4. Incluir plan de pruebas con TODOs
5. Hacer push con la flag `-u` si es un branch nuevo

> Para el proceso completo de desarrollo (planificación, TDD, revisión de código) antes de las operaciones de git,
> ver [development-workflow.md](./development-workflow.md).
