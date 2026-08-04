---
name: quarkus-verification
description: "Bucle de verificación para proyectos Quarkus: build, análisis estático, pruebas con cobertura, escaneos de seguridad, compilación nativa y revisión de diff antes del lanzamiento o PR."
origin: ECC
---

# Bucle de Verificación Quarkus

Ejecutar antes de PRs, después de cambios importantes y antes del despliegue.

## Cuándo Activar

- Antes de abrir un pull request para un servicio Quarkus
- Después de refactorizaciones importantes o actualizaciones de dependencias
- Verificación previa al despliegue para staging o producción
- Ejecutar el pipeline completo de build → lint → test → escaneo de seguridad → compilación nativa
- Validar que la cobertura de pruebas cumpla los umbrales (80%+)
- Probar compatibilidad con imagen nativa

## Fase 1: Build

```bash
# Maven
mvn clean verify -DskipTests

# Gradle
./gradlew clean assemble -x test
```

Si el build falla, detener y corregir errores de compilación.

## Fase 2: Análisis Estático

### Checkstyle, PMD, SpotBugs (Maven)

```bash
mvn checkstyle:check pmd:check spotbugs:check
```

### SonarQube (si está configurado)

```bash
mvn sonar:sonar \
  -Dsonar.projectKey=my-quarkus-project \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.login=${SONAR_TOKEN}
```

### Problemas Comunes a Resolver

- Importaciones o variables sin usar
- Métodos complejos (alta complejidad ciclomática)
- Posibles desreferencias de puntero nulo
- Problemas de seguridad detectados por SpotBugs

## Fase 3: Pruebas + Cobertura

```bash
# Ejecutar todas las pruebas
mvn clean test

# Generar reporte de cobertura
mvn jacoco:report

# Exigir umbral de cobertura (80%)
mvn jacoco:check

# O con Gradle
./gradlew test jacocoTestReport jacocoTestCoverageVerification
```

### Categorías de Prueba

#### Pruebas Unitarias

```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {
  @Mock UserRepository userRepository;
  @InjectMocks UserService userService;

  @Test
  void createUser_validInput_returnsUser() {
    var dto = new CreateUserDto("Alice", "alice@example.com");

    doNothing().when(userRepository).persist(any(User.class));

    User result = userService.create(dto);

    assertThat(result.name).isEqualTo("Alice");
    verify(userRepository).persist(any(User.class));
  }
}
```

#### Pruebas de Integración

```java
@QuarkusTest
@QuarkusTestResource(PostgresTestResource.class)
class UserRepositoryIntegrationTest {

  @Inject
  UserRepository userRepository;

  @Test
  @Transactional
  void findByEmail_existingUser_returnsUser() {
    User user = new User();
    user.name = "Alice";
    user.email = "alice@example.com";
    userRepository.persist(user);

    Optional<User> found = userRepository.findByEmail("alice@example.com");

    assertThat(found).isPresent();
    assertThat(found.get().name).isEqualTo("Alice");
  }
}
```

#### Pruebas de API

```java
@QuarkusTest
class UserResourceTest {

  @Test
  void createUser_validInput_returns201() {
    given()
        .contentType(ContentType.JSON)
        .body("""
            {"name": "Alice", "email": "alice@example.com"}
            """)
        .when().post("/api/users")
        .then()
        .statusCode(201)
        .body("name", equalTo("Alice"));
  }

  @Test
  void createUser_invalidEmail_returns400() {
    given()
        .contentType(ContentType.JSON)
        .body("""
            {"name": "Alice", "email": "invalid"}
            """)
        .when().post("/api/users")
        .then()
        .statusCode(400);
  }
}
```

### Reporte de Cobertura

Verificar `target/site/jacoco/index.html` para cobertura detallada:
- Cobertura de líneas total (objetivo: 80%+)
- Cobertura de ramas (objetivo: 70%+)
- Identificar rutas críticas sin cobertura

## Fase 4: Escaneo de Seguridad

### Vulnerabilidades de Dependencias (Maven)

```bash
mvn org.owasp:dependency-check-maven:check
```

Revisar `target/dependency-check-report.html` para CVEs.

### Auditoría de Seguridad Quarkus

```bash
mvn quarkus:audit
mvn quarkus:list-extensions
```

### OWASP ZAP (Pruebas de Seguridad de API)

```bash
docker run -t owasp/zap2docker-stable zap-api-scan.py \
  -t http://localhost:8080/q/openapi \
  -f openapi
```

### Verificaciones de Seguridad Comunes

- [ ] Todos los secretos en variables de entorno (no en código)
- [ ] Validación de entrada en todos los endpoints
- [ ] Autenticación/autorización configurada
- [ ] CORS correctamente configurado
- [ ] Cabeceras de seguridad establecidas
- [ ] Contraseñas hasheadas con BCrypt
- [ ] Protección contra inyección SQL (consultas parametrizadas)
- [ ] Limitación de velocidad en endpoints públicos

## Fase 5: Compilación Nativa

Probar compatibilidad de imagen nativa GraalVM:

```bash
# Construir ejecutable nativo
mvn package -Dnative

# O con contenedor
mvn package -Dnative -Dquarkus.native.container-build=true

# Probar ejecutable nativo
./target/*-runner

# Ejecutar smoke tests básicos
curl http://localhost:8080/q/health/live
curl http://localhost:8080/q/health/ready
```

### Solución de Problemas de Imagen Nativa

Problemas comunes:
- **Reflexión**: Agregar config de reflexión para clases dinámicas
- **Recursos**: Incluir recursos con `quarkus.native.resources.includes`
- **JNI**: Registrar clases JNI si se usan bibliotecas nativas

Ejemplo de configuración de reflexión:
```java
@RegisterForReflection(targets = {MyDynamicClass.class})
public class ReflectionConfiguration {}
```

## Fase 6: Pruebas de Rendimiento

### Prueba de Carga con K6

```javascript
// load-test.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  const res = http.get('http://localhost:8080/api/markets');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });
}
```

```bash
k6 run load-test.js
```

## Fase 7: Health Checks

```bash
# Liveness
curl http://localhost:8080/q/health/live

# Readiness
curl http://localhost:8080/q/health/ready

# Todos los health checks
curl http://localhost:8080/q/health

# Métricas (si están habilitadas)
curl http://localhost:8080/q/metrics
```

## Fase 8: Build de Imagen de Contenedor

```bash
# Construir imagen de contenedor
mvn package -Dquarkus.container-image.build=true

# Escaneo de seguridad del contenedor
trivy image myorg/my-quarkus-app:1.0.0
grype myorg/my-quarkus-app:1.0.0
```

## Fase 9: Validación de Configuración

```bash
mvn quarkus:info
```

### Verificaciones por Entorno

- [ ] URLs de base de datos configuradas por entorno
- [ ] Secretos externalizados (Vault, variables de entorno)
- [ ] Niveles de logging apropiados
- [ ] Orígenes CORS configurados correctamente
- [ ] Limitación de velocidad configurada
- [ ] Monitoreo/trazado habilitado

## Fase 10: Revisión de Documentación

- [ ] Docs OpenAPI/Swagger actualizadas (`/q/swagger-ui`)
- [ ] README tiene instrucciones de configuración
- [ ] Cambios de API documentados
- [ ] Guía de migración para cambios disruptivos

Generar especificación OpenAPI:
```bash
curl http://localhost:8080/q/openapi -o openapi.json
```

## Lista de Verificación

### Calidad del Código
- [ ] El build pasa sin advertencias
- [ ] Análisis estático limpio (sin problemas altos/medios)
- [ ] El código sigue las convenciones del equipo
- [ ] Sin código comentado ni TODOs en el PR

### Pruebas
- [ ] Todas las pruebas pasan
- [ ] Cobertura de código ≥ 80%
- [ ] Pruebas de integración con base de datos real
- [ ] Pruebas de seguridad pasan
- [ ] Rendimiento dentro de límites aceptables

### Seguridad
- [ ] Sin vulnerabilidades en dependencias
- [ ] Autenticación/autorización probada
- [ ] Validación de entrada completa
- [ ] Secretos no en código fuente
- [ ] Cabeceras de seguridad configuradas

### Despliegue
- [ ] Compilación nativa exitosa
- [ ] Imagen de contenedor construida
- [ ] Health checks responden correctamente
- [ ] Configuración válida para el entorno objetivo

## Script de Verificación Automatizado

```bash
#!/bin/bash
set -e

echo "=== Fase 1: Build ==="
mvn clean verify -DskipTests

echo "=== Fase 2: Análisis Estático ==="
mvn checkstyle:check pmd:check spotbugs:check

echo "=== Fase 3: Pruebas + Cobertura ==="
mvn test jacoco:report jacoco:check

echo "=== Fase 4: Escaneo de Seguridad ==="
mvn org.owasp:dependency-check-maven:check

echo "=== Fase 5: Compilación Nativa ==="
mvn package -Dnative -Dquarkus.native.container-build=true

echo "=== Todas las Fases Completadas ==="
echo "Revisar reportes:"
echo "  - Cobertura: target/site/jacoco/index.html"
echo "  - Seguridad: target/dependency-check-report.html"
```

## Buenas Prácticas

- Ejecutar el bucle de verificación antes de cada PR
- Automatizar en el pipeline CI/CD
- Corregir problemas inmediatamente; no acumular deuda técnica
- Mantener cobertura por encima del 80%
- Actualizar dependencias regularmente
- Probar compilación nativa periódicamente
- Monitorear tendencias de rendimiento
- Documentar cambios disruptivos
