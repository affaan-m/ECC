---
name: springboot-security
description: Buenas prácticas de Spring Security para autenticación/autorización, validación, CSRF, secretos, cabeceras, limitación de velocidad y seguridad de dependencias en servicios Java Spring Boot.
origin: ECC
---

# Revisión de Seguridad Spring Boot

Usar al agregar autenticación, manejar entradas, crear endpoints o trabajar con secretos.

## Cuándo Activar

- Agregar autenticación (JWT, OAuth2, basada en sesión)
- Implementar autorización (@PreAuthorize, control de acceso basado en roles)
- Validar entrada de usuario (Bean Validation, validadores personalizados)
- Configurar CORS, CSRF o cabeceras de seguridad
- Gestionar secretos (Vault, variables de entorno)
- Agregar limitación de velocidad o protección contra fuerza bruta
- Escanear dependencias por CVEs

## Autenticación

- Preferir JWT sin estado o tokens opacos con lista de revocación
- Usar cookies `httpOnly`, `Secure`, `SameSite=Strict` para sesiones
- Validar tokens con `OncePerRequestFilter` o resource server

```java
@Component
public class JwtAuthFilter extends OncePerRequestFilter {
  private final JwtService jwtService;

  public JwtAuthFilter(JwtService jwtService) {
    this.jwtService = jwtService;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
      FilterChain chain) throws ServletException, IOException {
    String header = request.getHeader(HttpHeaders.AUTHORIZATION);
    if (header != null && header.startsWith("Bearer ")) {
      String token = header.substring(7);
      Authentication auth = jwtService.authenticate(token);
      SecurityContextHolder.getContext().setAuthentication(auth);
    }
    chain.doFilter(request, response);
  }
}
```

## Autorización

- Habilitar seguridad de métodos: `@EnableMethodSecurity`
- Usar `@PreAuthorize("hasRole('ADMIN')")` o `@PreAuthorize("@authz.canEdit(#id)")`
- Denegar por defecto; exponer solo los scopes requeridos

```java
@RestController
@RequestMapping("/api/admin")
public class AdminController {

  @PreAuthorize("hasRole('ADMIN')")
  @GetMapping("/users")
  public List<UserDto> listUsers() {
    return userService.findAll();
  }

  @PreAuthorize("@authz.isOwner(#id, authentication)")
  @DeleteMapping("/users/{id}")
  public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
    userService.delete(id);
    return ResponseEntity.noContent().build();
  }
}
```

## Validación de Entrada

- Usar Bean Validation con `@Valid` en controllers
- Aplicar restricciones en DTOs: `@NotBlank`, `@Email`, `@Size`, validadores personalizados
- Sanitizar cualquier HTML con lista blanca antes de renderizar

```java
// MAL: Sin validación
@PostMapping("/users")
public User createUser(@RequestBody UserDto dto) {
  return userService.create(dto);
}

// BIEN: DTO validado
public record CreateUserDto(
    @NotBlank @Size(max = 100) String name,
    @NotBlank @Email String email,
    @NotNull @Min(0) @Max(150) Integer age
) {}

@PostMapping("/users")
public ResponseEntity<UserDto> createUser(@Valid @RequestBody CreateUserDto dto) {
  return ResponseEntity.status(HttpStatus.CREATED)
      .body(userService.create(dto));
}
```

## Prevención de Inyección SQL

- Usar repositorios de Spring Data o consultas parametrizadas
- Para consultas nativas, usar bindings `:param`; nunca concatenar cadenas

```java
// MAL: Concatenación de cadenas en consulta nativa
@Query(value = "SELECT * FROM users WHERE name = '" + name + "'", nativeQuery = true)

// BIEN: Consulta nativa parametrizada
@Query(value = "SELECT * FROM users WHERE name = :name", nativeQuery = true)
List<User> findByName(@Param("name") String name);

// BIEN: Consulta derivada de Spring Data (auto-parametrizada)
List<User> findByEmailAndActiveTrue(String email);
```

## Codificación de Contraseñas

- Siempre hashear contraseñas con BCrypt o Argon2 — nunca almacenar en texto plano
- Usar el bean `PasswordEncoder`, no hashing manual

```java
@Bean
public PasswordEncoder passwordEncoder() {
  return new BCryptPasswordEncoder(12); // factor de costo 12
}

// En el servicio
public User register(CreateUserDto dto) {
  String hashedPassword = passwordEncoder.encode(dto.password());
  return userRepository.save(new User(dto.email(), hashedPassword));
}
```

## Protección CSRF

- Para aplicaciones de sesión de navegador, mantener CSRF habilitado; incluir token en formularios/cabeceras
- Para APIs puras con tokens Bearer, deshabilitar CSRF y depender de autenticación sin estado

```java
http
  .csrf(csrf -> csrf.disable())
  .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
```

## Gestión de Secretos

- Sin secretos en el código fuente; cargar desde entorno o vault
- Mantener `application.yml` libre de credenciales; usar marcadores de posición
- Rotar tokens y credenciales de base de datos regularmente

```yaml
# MAL: Hardcodeado en application.yml
spring:
  datasource:
    password: mySecretPassword123

# BIEN: Marcador de variable de entorno
spring:
  datasource:
    password: ${DB_PASSWORD}

# BIEN: Integración con Spring Cloud Vault
spring:
  cloud:
    vault:
      uri: https://vault.example.com
      token: ${VAULT_TOKEN}
```

## Cabeceras de Seguridad

```java
http
  .headers(headers -> headers
    .contentSecurityPolicy(csp -> csp
      .policyDirectives("default-src 'self'"))
    .frameOptions(HeadersConfigurer.FrameOptionsConfig::sameOrigin)
    .xssProtection(Customizer.withDefaults())
    .referrerPolicy(rp -> rp.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)));
```

## Configuración de CORS

- Configurar CORS a nivel del filtro de seguridad, no por controller
- Restringir orígenes permitidos — nunca usar `*` en producción

```java
@Bean
public CorsConfigurationSource corsConfigurationSource() {
  CorsConfiguration config = new CorsConfiguration();
  config.setAllowedOrigins(List.of("https://app.example.com"));
  config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
  config.setAllowedHeaders(List.of("Authorization", "Content-Type"));
  config.setAllowCredentials(true);
  config.setMaxAge(3600L);

  UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
  source.registerCorsConfiguration("/api/**", config);
  return source;
}

// En SecurityFilterChain:
http.cors(cors -> cors.configurationSource(corsConfigurationSource()));
```

## Limitación de Velocidad

- Aplicar Bucket4j o límites a nivel de gateway en endpoints costosos
- Registrar y alertar sobre ráfagas; retornar 429 con hints de reintento

```java
// Usar Bucket4j para limitación de velocidad por endpoint
@Component
public class RateLimitFilter extends OncePerRequestFilter {
  private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

  private Bucket createBucket() {
    return Bucket.builder()
        .addLimit(Bandwidth.classic(100, Refill.intervally(100, Duration.ofMinutes(1))))
        .build();
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
      FilterChain chain) throws ServletException, IOException {
    String clientIp = request.getRemoteAddr();
    Bucket bucket = buckets.computeIfAbsent(clientIp, k -> createBucket());

    if (bucket.tryConsume(1)) {
      chain.doFilter(request, response);
    } else {
      response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
      response.getWriter().write("{\"error\": \"Rate limit exceeded\"}");
    }
  }
}
```

## Seguridad de Dependencias

- Ejecutar OWASP Dependency Check / Snyk en CI
- Mantener Spring Boot y Spring Security en versiones soportadas
- Fallar builds ante CVEs conocidos

## Logging y PII

- Nunca registrar secretos, tokens, contraseñas ni datos PAN completos
- Redactar campos sensibles; usar logging JSON estructurado

## Subida de Archivos

- Validar tamaño, tipo de contenido y extensión
- Almacenar fuera del web root; escanear si es requerido

## Lista de Verificación Antes del Lanzamiento

- [ ] Tokens de autenticación validados y con expiración correcta
- [ ] Guardias de autorización en cada ruta sensible
- [ ] Todas las entradas validadas y sanitizadas
- [ ] Sin SQL concatenado con cadenas
- [ ] Postura CSRF correcta para el tipo de aplicación
- [ ] Secretos externalizados; ninguno con commit
- [ ] Cabeceras de seguridad configuradas
- [ ] Limitación de velocidad en APIs
- [ ] Dependencias escaneadas y actualizadas
- [ ] Logs libres de datos sensibles

**Recuerda**: Denegar por defecto, validar entradas, privilegio mínimo y seguro por configuración primero.
