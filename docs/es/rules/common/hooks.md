# Sistema de Hooks

## Tipos de Hooks

- **PreToolUse**: Antes de la ejecución de herramientas (validación, modificación de parámetros)
- **PostToolUse**: Después de la ejecución de herramientas (auto-formato, verificaciones)
- **Stop**: Cuando la sesión termina (verificación final)

## Permisos de Auto-Aceptación

Usar con precaución:
- Habilitar para planes bien definidos y de confianza
- Deshabilitar para trabajo exploratorio
- Nunca usar la flag dangerously-skip-permissions
- Configurar `allowedTools` en `~/.claude.json` en su lugar

## Buenas Prácticas de TodoWrite

Usar la herramienta TodoWrite para:
- Rastrear el progreso en tareas de múltiples pasos
- Verificar la comprensión de las instrucciones
- Permitir redirección en tiempo real
- Mostrar pasos de implementación granulares

La lista de tareas revela:
- Pasos fuera de orden
- Elementos faltantes
- Elementos adicionales innecesarios
- Granularidad incorrecta
- Requisitos mal interpretados
