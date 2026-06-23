---
name: springboot-verification
description: "Bucle de verificación para proyectos Spring Boot: build, análisis estático, pruebas con cobertura, escaneos de seguridad y revisión de diff antes del lanzamiento o PR."
origin: ECC
---

# Bucle de Verificación Spring Boot

Ejecutar antes de PRs, después de cambios importantes y antes del despliegue.

## Cuándo Activar

- Antes de abrir un pull request para un servicio Spring Boot
- Después de refactorizaciones importantes o actualizaciones de dependencias
- Verificación previa al despliegue para staging o producción
- Ejecutar el pipeline completo de build → lint → test → escaneo de seguridad
- Validar que la cobertura de pruebas cumpla los umbrales

## Fase 1: Build

```bash
mvn -T 4 clean verify -DskipTests
# o
./gradlew clean assemble -x test
```

Si el build falla, detener y corregir.

## Fase 2: Análisis Estático

Maven (plugins comunes):
```bash
mvn -T 4 spotbugs:check pmd:check checkstyle:check
```

Gradle (si está configurado):
```bash
./gradlew checkstyleMain pmdMain spotbugsMain
```

## Fase 3: Pruebas + Cobertura

```bash
mvn -T 4 test
mvn jacoco:report   # verificar cobertura 80%+
# o
./gradlew test jacocoTestReport
```

Reporte:
- Total de pruebas, pasadas/fallidas
- % de cobertura (líneas/ramas)

### Pruebas Unitarias

Probar la lógica del servicio en aislamiento con dependencias mockeadas:

```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

  @Mock private UserRepository userRepository;
  @InjectMocks private UserService userService;

  @Test
  void createUser_validInput_returnsUser() {
    var dto = new CreateUserDto("Alice", "alice@example.com");
    var expected = new User(1L, "Alice", "alice@example.com");
    when(userRepository.save(any(User.class))).thenReturn(expected);

    var result = userService.create(dto);

    assertThat(result.name()).isEqualTo("Alice");
    verify(userRepository).save(any(User.class));
  }

  @Test
  void createUser_duplicateEmail_throwsException() {
    var dto = new CreateUserDto("Alice", "existing@example.com");
    when(userRepository.existsByEmail(dto.email())).thenReturn(true);

    assertThatThrownBy(() -> userService.create(dto))
        .isInstanceOf(DuplicateEmailException.class);
  }
}
```

### Pruebas de Integración con Testcontainers

Probar contra una base de datos real en lugar de H2:

```java
@SpringBootTest
@Testcontainers
class UserRepositoryIntegrationTest {

  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
      .withDatabaseName("testdb");

  @DynamicPropertySource
  static void configureProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", postgres::getJdbcUrl);
    registry.add("spring.datasource.username", postgres::getUsername);
    registry.add("spring.datasource.password", postgres::getPassword);
  }

  @Autowired private UserRepository userRepository;

  @Test
  void findByEmail_existingUser_returnsUser() {
    userRepository.save(new User("Alice", "alice@example.com"));

    var found = userRepository.findByEmail("alice@example.com");

    assertThat(found).isPresent();
    assertThat(found.get().getName()).isEqualTo("Alice");
  }
}
```

### Pruebas de API con MockMvc

Probar la capa controller con el contexto completo de Spring:

```java
@WebMvcTest(UserController.class)
class UserControllerTest {

  @Autowired private MockMvc mockMvc;
  @MockBean private UserService userService;

  @Test
  void createUser_validInput_returns201() throws Exception {
    var user = new UserDto(1L, "Alice", "alice@example.com");
    when(userService.create(any())).thenReturn(user);

    mockMvc.perform(post("/api/users")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"name": "Alice", "email": "alice@example.com"}
                """))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("Alice"));
  }

  @Test
  void createUser_invalidEmail_returns400() throws Exception {
    mockMvc.perform(post("/api/users")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"name": "Alice", "email": "not-an-email"}
                """))
        .andExpect(status().isBadRequest());
  }
}
```

## Fase 4: Escaneo de Seguridad

```bash
# CVEs de dependencias
mvn org.owasp:dependency-check-maven:check
# o
./gradlew dependencyCheckAnalyze

# Secretos en código fuente
grep -rn "password\s*=\s*\"" src/ --include="*.java" --include="*.yml" --include="*.properties"
grep -rn "sk-\|api_key\|secret" src/ --include="*.java" --include="*.yml"

# Secretos (historial de git)
git secrets --scan  # si está configurado
```

### Hallazgos Comunes de Seguridad

```bash
# Verificar System.out.println (usar logger en su lugar)
grep -rn "System\.out\.print" src/main/ --include="*.java"

# Verificar mensajes de excepción en bruto en respuestas
grep -rn "e\.getMessage()" src/main/ --include="*.java"

# Verificar CORS comodín
grep -rn "allowedOrigins.*\*" src/main/ --include="*.java"
```

## Fase 5: Lint/Formato (compuerta opcional)

```bash
mvn spotless:apply   # si se usa el plugin Spotless
./gradlew spotlessApply
```

## Fase 6: Revisión de Diff

```bash
git diff --stat
git diff
```

Lista de verificación:
- Sin logs de depuración residuales (`System.out`, `log.debug` sin guardias)
- Errores y códigos HTTP con significado
- Transacciones y validación presentes donde se necesitan
- Cambios de configuración documentados

## Plantilla de Salida

```
REPORTE DE VERIFICACIÓN
=======================
Build:      [PASS/FAIL]
Estático:   [PASS/FAIL] (spotbugs/pmd/checkstyle)
Pruebas:    [PASS/FAIL] (X/Y pasadas, Z% cobertura)
Seguridad:  [PASS/FAIL] (hallazgos CVE: N)
Diff:       [X archivos modificados]

General:    [LISTO / NO LISTO]

Problemas a Corregir:
1. ...
2. ...
```

## Modo Continuo

- Volver a ejecutar las fases ante cambios significativos o cada 30–60 minutos en sesiones largas
- Mantener un bucle corto: `mvn -T 4 test` + spotbugs para retroalimentación rápida

**Recuerda**: La retroalimentación rápida supera las sorpresas tardías. Mantener la compuerta estricta — tratar las advertencias como defectos en sistemas de producción.
