# Patrones Comunes

## Proyectos Esqueleto

Al implementar nueva funcionalidad:
1. Buscar proyectos esqueleto probados en batalla
2. Usar agentes paralelos para evaluar opciones:
   - Evaluación de seguridad
   - Análisis de extensibilidad
   - Puntuación de relevancia
   - Planificación de implementación
3. Clonar la mejor coincidencia como fundación
4. Iterar dentro de la estructura probada

## Patrones de Diseño

### Patrón Repository

Encapsular el acceso a datos detrás de una interfaz consistente:
- Definir operaciones estándar: findAll, findById, create, update, delete
- Las implementaciones concretas manejan los detalles de almacenamiento (base de datos, API, archivo, etc.)
- La lógica de negocio depende de la interfaz abstracta, no del mecanismo de almacenamiento
- Permite cambiar fácilmente las fuentes de datos y simplifica las pruebas con mocks

### Formato de Respuesta de API

Usar un envelope consistente para todas las respuestas de API:
- Incluir un indicador de éxito/estado
- Incluir el payload de datos (nullable en error)
- Incluir un campo de mensaje de error (nullable en éxito)
- Incluir metadatos para respuestas paginadas (total, page, limit)
