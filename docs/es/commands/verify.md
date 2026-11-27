# Comando Verify

Ejecutar verificación exhaustiva sobre el estado actual del código base.

## Instrucciones

Ejecutar la verificación exactamente en este orden:

1. **Verificación de Build**
   - Ejecutar el comando de build para este proyecto
   - Si falla, reportar los errores y DETENER

2. **Verificación de Tipos**
   - Ejecutar TypeScript/verificador de tipos
   - Reportar todos los errores con archivo:línea

3. **Verificación de Lint**
   - Ejecutar el linter
   - Reportar advertencias y errores

4. **Suite de Pruebas**
   - Ejecutar todas las pruebas
   - Reportar cantidad de pasadas/fallidas
   - Reportar porcentaje de cobertura

5. **Auditoría de console.log**
   - Buscar console.log en los archivos fuente
   - Reportar las ubicaciones

6. **Estado de Git**
   - Mostrar cambios no confirmados
   - Mostrar archivos modificados desde el último commit

## Salida

Generar un reporte de verificación resumido:

```
VERIFICACIÓN: [PASÓ/FALLÓ]

Build:    [OK/FALLÓ]
Tipos:    [OK/X errores]
Lint:     [OK/X problemas]
Pruebas:  [X/Y pasaron, Z% cobertura]
Secretos: [OK/X encontrados]
Logs:     [OK/X console.log]

Listo para PR: [SÍ/NO]
```

Si hay algún problema crítico, listarlos con sugerencias de corrección.

## Argumentos

$ARGUMENTS puede ser:
- `quick` - Solo build + tipos
- `full` - Todas las verificaciones (por defecto)
- `pre-commit` - Verificaciones relevantes para commits
- `pre-pr` - Escaneo de seguridad más verificaciones completas
