# Directrices de Seguridad

## Verificaciones de Seguridad Obligatorias

Antes de CUALQUIER commit:
- [ ] Sin secretos hardcodeados (claves de API, contraseñas, tokens)
- [ ] Todas las entradas de usuario validadas
- [ ] Prevención de inyección SQL (consultas parametrizadas)
- [ ] Prevención de XSS (HTML sanitizado)
- [ ] Protección CSRF habilitada
- [ ] Autenticación/autorización verificada
- [ ] Rate limiting en todos los endpoints
- [ ] Los mensajes de error no filtran datos sensibles

## Gestión de Secretos

- NUNCA hardcodear secretos en el código fuente
- SIEMPRE usar variables de entorno o un gestor de secretos
- Validar que los secretos requeridos estén presentes al iniciar
- Rotar cualquier secreto que pueda haber sido expuesto

## Protocolo de Respuesta a Seguridad

Si se encuentra un problema de seguridad:
1. DETENER inmediatamente
2. Usar el agente **security-reviewer**
3. Corregir problemas CRÍTICOS antes de continuar
4. Rotar cualquier secreto expuesto
5. Revisar todo el código base en busca de problemas similares
