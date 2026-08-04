# Flujo de Trabajo de Desarrollo

> Este archivo extiende [common/git-workflow.md](./git-workflow.md) con el proceso completo de desarrollo de features que ocurre antes de las operaciones de git.

El Flujo de Trabajo de Implementación de Features describe el pipeline de desarrollo: investigación, planificación, TDD, revisión de código y luego commit a git.

## Flujo de Trabajo de Implementación de Features

0. **Investigación y Reutilización** _(obligatorio antes de cualquier nueva implementación)_
   - **Búsqueda en código de GitHub primero:** Ejecutar `gh search repos` y `gh search code` para encontrar implementaciones existentes, plantillas y patrones antes de escribir nada nuevo.
   - **Docs de librerías segundo:** Usar Context7 o los docs del proveedor principal para confirmar el comportamiento de las APIs, uso de paquetes y detalles específicos de versión antes de implementar.
   - **Exa solo cuando los dos primeros son insuficientes:** Usar Exa para investigación web más amplia o descubrimiento después de la búsqueda en GitHub y los docs principales.
   - **Verificar registros de paquetes:** Buscar en npm, PyPI, crates.io y otros registros antes de escribir código de utilidades. Preferir librerías probadas en batalla sobre soluciones escritas a mano.
   - **Buscar implementaciones adaptables:** Buscar proyectos open-source que resuelvan el 80%+ del problema y puedan ser forkeados, portados o envueltos.
   - Preferir adoptar o portar un enfoque probado antes de escribir código nuevo cuando cumple el requisito.

1. **Planificar Primero**
   - Usar el agente **planner** para crear un plan de implementación
   - Generar documentos de planificación antes de codificar: PRD, arquitectura, system_design, tech_doc, task_list
   - Identificar dependencias y riesgos
   - Desglosar en fases

2. **Enfoque TDD**
   - Usar el agente **tdd-guide**
   - Escribir pruebas primero (ROJO)
   - Implementar para que pasen las pruebas (VERDE)
   - Refactorizar (MEJORAR)
   - Verificar cobertura del 80%+

3. **Revisión de Código**
   - Usar el agente **code-reviewer** inmediatamente después de escribir código
   - Abordar problemas CRÍTICOS y ALTOS
   - Corregir problemas MEDIOS cuando sea posible

4. **Commit y Push**
   - Mensajes de commit detallados
   - Seguir el formato de conventional commits
   - Ver [git-workflow.md](./git-workflow.md) para el formato de mensajes de commit y el proceso de PR

5. **Verificaciones Pre-Revisión**
   - Verificar que todas las verificaciones automatizadas (CI/CD) estén pasando
   - Resolver cualquier conflicto de merge
   - Asegurar que el branch esté actualizado con el branch objetivo
   - Solo solicitar revisión después de que estas verificaciones pasen
