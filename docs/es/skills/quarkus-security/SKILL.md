---
name: quarkus-security
description: Buenas prácticas de seguridad en Quarkus para autenticación, autorización, JWT/OIDC, RBAC, validación de entrada, CSRF, gestión de secretos y seguridad de dependencias.
origin: ECC
---

# Revisión de Seguridad Quarkus

Buenas prácticas para asegurar aplicaciones Quarkus con autenticación, autorización y validación de entrada.

## Cuándo Activar

- Agregar autenticación (JWT, OIDC, Basic Auth)
- Implementar autorización con @RolesAllowed o SecurityIdentity
- Validar entrada de usuario (Bean Validation, validadores personalizados)
- Configurar CORS o cabeceras de seguridad
- Gestionar secretos (Vault, variables de entorno, fuentes de configuración)
- Agregar limitación de velocidad o protección contra fuerza bruta
- Escanear dependencias por CVEs
- Trabajar con MicroProfile JWT o SmallRye JWT

## Autenticación

### Autenticación JWT

```java
// Recurso protegido con JWT
@Path("/api/protected")
@Authenticated
public class ProtectedResource {

  @Inject
  JsonWebToken jwt;

  @Inject
  SecurityIdentity securityIdentity;

  @GET
  public Response getData() {
    String username = jwt.getName();
    Set<String> roles = jwt.getGroups();
    return Response.ok(Map.of(
        "username", username,
        "roles", roles,
        "principal", securityIdentity.getPrincipal().getName()
    )).build();
  }
}
```

Configuración (application.properties):
```properties
mp.jwt.verify.publickey.location=publicKey.pem
mp.jwt.verify.issuer=https://auth.example.com

# OIDC
quarkus.oidc.auth-server-url=https://auth.example.com/realms/myrealm
quarkus.oidc.client-id=backend-service
quarkus.oidc.credentials.secret=${OIDC_SECRET}
```

### Filtro de Autenticación Personalizado

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class CustomAuthFilter implements ContainerRequestFilter {

  @Inject
  SecurityIdentity identity;

  @Override
  public void filter(ContainerRequestContext requestContext) {
    String authHeader = requestContext.getHeaderString(HttpHeaders.AUTHORIZATION);

    if (authHeader == null || !authHeader.startsWith("Bearer ")) {
      requestContext.abortWith(Response.status(Response.Status.UNAUTHORIZED).build());
      return;
    }

    String token = authHeader.substring(7);
    if (!validateToken(token)) {
      requestContext.abortWith(Response.status(Response.Status.UNAUTHORIZED).build());
    }
  }

  private boolean validateToken(String token) {
    return true;
  }
}
```

## Autorización

### Control de Acceso Basado en Roles

```java
@Path("/api/admin")
@RolesAllowed("ADMIN")
public class AdminResource {

  @GET
  @Path("/users")
  public List<UserDto> listUsers() {
    return userService.findAll();
  }

  @DELETE
  @Path("/users/{id}")
  @RolesAllowed({"ADMIN", "SUPER_ADMIN"})
  public Response deleteUser(@PathParam("id") Long id) {
    userService.delete(id);
    return Response.noContent().build();
  }
}

@Path("/api/users")
public class UserResource {

  @Inject
  SecurityIdentity securityIdentity;

  @GET
  @Path("/{id}")
  @RolesAllowed("USER")
  public Response getUser(@PathParam("id") Long id) {
    if (!securityIdentity.hasRole("ADMIN") &&
        !isOwner(id, securityIdentity.getPrincipal().getName())) {
      return Response.status(Response.Status.FORBIDDEN).build();
    }
    return Response.ok(userService.findById(id)).build();
  }
}
```

### Seguridad Programática

```java
@ApplicationScoped
public class SecurityService {

  @Inject
  SecurityIdentity securityIdentity;

  public boolean canAccessResource(Long resourceId) {
    if (securityIdentity.isAnonymous()) {
      return false;
    }

    if (securityIdentity.hasRole("ADMIN")) {
      return true;
    }

    String userId = securityIdentity.getPrincipal().getName();
    return resourceRepository.isOwner(resourceId, userId);
  }
}
```

## Validación de Entrada

### Bean Validation

```java
// MAL: Sin validación
@POST
public Response createUser(UserDto dto) {
  return Response.ok(userService.create(dto)).build();
}

// BIEN: DTO validado
public record CreateUserDto(
    @NotBlank @Size(max = 100) String name,
    @NotBlank @Email String email,
    @NotNull @Min(18) @Max(150) Integer age,
    @Pattern(regexp = "^\\+?[1-9]\\d{1,14}$") String phone
) {}

@POST
@Path("/users")
public Response createUser(@Valid CreateUserDto dto) {
  User user = userService.create(dto);
  return Response.status(Response.Status.CREATED).entity(user).build();
}
```

### Validadores Personalizados

```java
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = UsernameValidator.class)
public @interface ValidUsername {
  String message() default "Formato de nombre de usuario inválido";
  Class<?>[] groups() default {};
  Class<? extends Payload>[] payload() default {};
}

public class UsernameValidator implements ConstraintValidator<ValidUsername, String> {
  @Override
  public boolean isValid(String value, ConstraintValidatorContext context) {
    if (value == null) return false;
    return value.matches("^[a-zA-Z0-9_-]{3,20}$");
  }
}
```

## Prevención de Inyección SQL

### Panache Active Record (Seguro por Defecto)

```java
// BIEN: Consultas parametrizadas con Panache
List<User> users = User.list("email = ?1 and active = ?2", email, true);

Optional<User> user = User.find("username", username).firstResultOptional();

// BIEN: Parámetros nombrados
List<User> users = User.list("email = :email and age > :minAge",
    Parameters.with("email", email).and("minAge", 18));
```

### Consultas Nativas (Usar Parámetros)

```java
// MAL: Concatenación de cadenas
@Query(value = "SELECT * FROM users WHERE name = '" + name + "'", nativeQuery = true)

// BIEN: Consulta nativa parametrizada
@Entity
public class User extends PanacheEntity {
  public static List<User> findByEmailNative(String email) {
    return getEntityManager()
        .createNativeQuery("SELECT * FROM users WHERE email = :email", User.class)
        .setParameter("email", email)
        .getResultList();
  }
}
```

## Hash de Contraseñas

```java
@ApplicationScoped
public class PasswordService {

  public String hash(String plainPassword) {
    return BcryptUtil.bcryptHash(plainPassword);
  }

  public boolean verify(String plainPassword, String hashedPassword) {
    return BcryptUtil.matches(plainPassword, hashedPassword);
  }
}
```

## Configuración de CORS

```properties
# application.properties
quarkus.http.cors=true
quarkus.http.cors.origins=https://app.example.com,https://admin.example.com
quarkus.http.cors.methods=GET,POST,PUT,DELETE
quarkus.http.cors.headers=accept,authorization,content-type,x-requested-with
quarkus.http.cors.access-control-allow-credentials=true
```

## Gestión de Secretos

```properties
# application.properties - SIN SECRETOS AQUÍ

# Usar variables de entorno
quarkus.datasource.username=${DB_USER}
quarkus.datasource.password=${DB_PASSWORD}
quarkus.oidc.credentials.secret=${OIDC_CLIENT_SECRET}

# O usar Vault
quarkus.vault.url=https://vault.example.com
quarkus.vault.authentication.kubernetes.role=my-role
```

## Limitación de Velocidad

**Nota de Seguridad**: Nunca usar `X-Forwarded-For` directamente — los clientes pueden falsificarlo.
Usar la dirección remota real de la solicitud servlet, o una identidad autenticada
(clave API, subject del JWT) cuando esté disponible.

```java
@ApplicationScoped
public class RateLimitFilter implements ContainerRequestFilter {
  private final Map<String, RateLimiter> limiters = new ConcurrentHashMap<>();

  @Inject
  HttpServletRequest servletRequest;

  @Override
  public void filter(ContainerRequestContext requestContext) {
    String clientId = getClientIdentifier();
    RateLimiter limiter = limiters.computeIfAbsent(clientId,
        k -> RateLimiter.create(100.0)); // 100 solicitudes por segundo

    if (!limiter.tryAcquire()) {
      requestContext.abortWith(
          Response.status(429)
              .entity(Map.of("error", "Demasiadas solicitudes"))
              .build()
      );
    }
  }

  private String getClientIdentifier() {
    // Usar la dirección remota provista por el contenedor (no X-Forwarded-For).
    // Si está detrás de un proxy confiable, configurar
    // quarkus.http.proxy.proxy-address-forwarding=true
    // para que getRemoteAddr() retorne la IP real del cliente.
    return servletRequest.getRemoteAddr();
  }
}
```

## Cabeceras de Seguridad

```java
@Provider
public class SecurityHeadersFilter implements ContainerResponseFilter {

  @Override
  public void filter(ContainerRequestContext request, ContainerResponseContext response) {
    MultivaluedMap<String, Object> headers = response.getHeaders();

    headers.putSingle("X-Frame-Options", "DENY");
    headers.putSingle("X-Content-Type-Options", "nosniff");
    headers.putSingle("X-XSS-Protection", "1; mode=block");
    headers.putSingle("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // CSP: evitar 'unsafe-inline' para script-src; usar nonces o hashes
    headers.putSingle("Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  }
}
```

## Logging de Auditoría

```java
@ApplicationScoped
public class AuditService {
  private static final Logger LOG = Logger.getLogger(AuditService.class);

  @Inject
  SecurityIdentity securityIdentity;

  public void logAccess(String resource, String action) {
    String user = securityIdentity.isAnonymous()
        ? "anonymous"
        : securityIdentity.getPrincipal().getName();

    LOG.infof("AUDIT: user=%s action=%s resource=%s timestamp=%s",
        user, action, resource, Instant.now());
  }
}
```

## Escaneo de Seguridad de Dependencias

```bash
# Maven
mvn org.owasp:dependency-check-maven:check

# Gradle
./gradlew dependencyCheckAnalyze

# Verificar extensiones de Quarkus
quarkus extension list --installable
```

## Buenas Prácticas

- Siempre usar HTTPS en producción
- Habilitar JWT u OIDC para autenticación sin estado
- Usar `@RolesAllowed` para autorización declarativa
- Validar toda entrada con Bean Validation
- Hashear contraseñas con BCrypt (nunca texto plano)
- Almacenar secretos en Vault o variables de entorno
- Usar consultas parametrizadas para prevenir inyección SQL
- Agregar cabeceras de seguridad a todas las respuestas
- Implementar limitación de velocidad para endpoints públicos
- Auditar operaciones sensibles
- Mantener dependencias actualizadas y escanear por CVEs
- Usar SecurityIdentity para verificaciones programáticas
- Establecer políticas CORS apropiadas
- Probar rutas de autenticación y autorización
