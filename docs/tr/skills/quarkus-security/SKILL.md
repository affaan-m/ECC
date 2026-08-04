---
name: quarkus-security
description: Quarkus Security best practices for authentication, authorization, JWT/OIDC, RBAC, input validation, CSRF, secrets management, and dependency security.
origin: ECC
---

# Quarkus Güvenlik İncelemesi

Kimlik doğrulama, yetkilendirme ve girdi doğrulama ile Quarkus uygulamalarını güvenli hale getirmek için en iyi uygulamalar.

## When to Use

- Kimlik doğrulama ekleme (JWT, OIDC, Basic Auth)
- `@RolesAllowed` veya SecurityIdentity ile yetkilendirme uygulama
- Kullanıcı girişini doğrulama (Bean Validation, özel doğrulayıcılar)
- CORS veya güvenlik başlıklarını yapılandırma
- Gizli bilgileri yönetme (Vault, ortam değişkenleri, config kaynakları)
- Rate limiting veya brute-force koruması ekleme
- Bağımlılıkları CVE için tarama
- MicroProfile JWT veya SmallRye JWT ile çalışma

## How It Works

Quarkus güvenliğini katmanlı uygulayın: JWT/OIDC veya Basic Auth ile kimliği
doğrulayın, `SecurityIdentity` ve `@RolesAllowed` ile yetki kararlarını
merkezileştirin, Bean Validation ile girdileri sınırlandırın, CORS ve güvenlik
başlıklarını açıkça yapılandırın, gizli bilgileri Vault veya ortam değişkenleri
üzerinden yönetin.

## Examples

### Kimlik Doğrulama

### JWT Kimlik Doğrulama

```java
// JWT ile korunan resource
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

Yapılandırma (application.properties):
```properties
mp.jwt.verify.publickey.location=publicKey.pem
mp.jwt.verify.issuer=https://auth.example.com

# OIDC
quarkus.oidc.auth-server-url=https://auth.example.com/realms/myrealm
quarkus.oidc.client-id=backend-service
quarkus.oidc.credentials.secret=${OIDC_SECRET}
```

### Özel Kimlik Doğrulama Filtresi

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class CustomAuthFilter implements ContainerRequestFilter {

  @Inject
  SecurityIdentity identity;

  @Override
  public void filter(ContainerRequestContext requestContext) {
    String authHeader = requestContext.getHeaderString(HttpHeaders.AUTHORIZATION);

    // Başlık yoksa veya hatalıysa hemen reddet
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
    // Token doğrulama mantığı
    return true;
  }
}
```

## Yetkilendirme

### Rol Tabanlı Erişim Kontrolü

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
    // Sahipliği kontrol et
    if (!securityIdentity.hasRole("ADMIN") &&
        !isOwner(id, securityIdentity.getPrincipal().getName())) {
      return Response.status(Response.Status.FORBIDDEN).build();
    }
    return Response.ok(userService.findById(id)).build();
  }

  private boolean isOwner(Long userId, String username) {
    return userService.isOwner(userId, username);
  }
}
```

### Programatik Güvenlik

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

## Girdi Doğrulama

### Bean Validation

```java
// KÖTÜ: Validation yok
@POST
public Response createUser(UserDto dto) {
  return Response.ok(userService.create(dto)).build();
}

// İYİ: Doğrulanmış DTO
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

### Özel Doğrulayıcılar

```java
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = UsernameValidator.class)
public @interface ValidUsername {
  String message() default "Invalid username format";
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

// Kullanım
public record CreateUserDto(
    @ValidUsername String username,
    @NotBlank @Email String email
) {}
```

## SQL Injection Önleme

### Panache Active Record (Varsayılan Olarak Güvenli)

```java
// İYİ: Panache ile parametreli sorgular
List<User> users = User.list("email = ?1 and active = ?2", email, true);

Optional<User> user = User.find("username", username).firstResultOptional();

// İYİ: İsimlendirilmiş parametreler
List<User> users = User.list("email = :email and age > :minAge",
    Parameters.with("email", email).and("minAge", 18));
```

### Native Sorgular (Parametre Kullanın)

```java
// KÖTÜ: String birleştirme
@Query(value = "SELECT * FROM users WHERE name = '" + name + "'", nativeQuery = true)

// İYİ: Parametreli native sorgu
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

## Parola Hash'leme

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

// Servis içinde
@ApplicationScoped
public class UserService {
  @Inject
  PasswordService passwordService;

  @Transactional
  public User register(CreateUserDto dto) {
    String hashedPassword = passwordService.hash(dto.password());
    User user = new User();
    user.email = dto.email();
    user.password = hashedPassword;
    user.persist();
    return user;
  }

  public boolean authenticate(String email, String password) {
    return User.find("email", email)
        .firstResultOptional()
        .map(u -> passwordService.verify(password, u.password))
        .orElse(false);
  }
}
```

## CORS Yapılandırması

```properties
# application.properties
quarkus.http.cors=true
quarkus.http.cors.origins=https://app.example.com,https://admin.example.com
quarkus.http.cors.methods=GET,POST,PUT,DELETE
quarkus.http.cors.headers=accept,authorization,content-type,x-requested-with
quarkus.http.cors.exposed-headers=Content-Disposition
quarkus.http.cors.access-control-max-age=24H
quarkus.http.cors.access-control-allow-credentials=true
```

## Gizli Bilgi Yönetimi

```properties
# application.properties - BURADA GİZLİ BİLGİ YOK

# Ortam değişkenlerini kullanın
quarkus.datasource.username=${DB_USER}
quarkus.datasource.password=${DB_PASSWORD}
quarkus.oidc.credentials.secret=${OIDC_CLIENT_SECRET}

# Or use Vault
quarkus.vault.url=https://vault.example.com
quarkus.vault.authentication.kubernetes.role=my-role
```

### HashiCorp Vault Entegrasyonu

```java
@ApplicationScoped
public class SecretService {

  @ConfigProperty(name = "api-key")
  String apiKey; // Vault'tan alınır

  public String getSecret(String key) {
    return ConfigProvider.getConfig().getValue(key, String.class);
  }
}
```

## Rate Limiting (Hız Sınırlama)

**Güvenlik Notu**: `X-Forwarded-For` doğrudan kullanmayın — istemciler bunu taklit edebilir.
Servlet request'ten gerçek uzak adresi veya kimliği doğrulanmış bir kimlik (API anahtarı, JWT subject) kullanın.

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
        k -> RateLimiter.create(100.0)); // Saniyede 100 istek

    if (!limiter.tryAcquire()) {
      requestContext.abortWith(
          Response.status(429)
              .entity(Map.of("error", "Too many requests"))
              .build()
      );
    }
  }

  private String getClientIdentifier() {
    // Konteyner tarafından sağlanan uzak adresi kullanın (X-Forwarded-For değil).
    // Güvenilir proxy arkasındaysanız quarkus.http.proxy.proxy-address-forwarding=true ayarlayın.
    return servletRequest.getRemoteAddr();
  }
}
```

## Güvenlik Başlıkları

```java
@Provider
public class SecurityHeadersFilter implements ContainerResponseFilter {

  @Override
  public void filter(ContainerRequestContext request, ContainerResponseContext response) {
    MultivaluedMap<String, Object> headers = response.getHeaders();

    // Clickjacking'i önle
    headers.putSingle("X-Frame-Options", "DENY");

    // XSS koruması
    headers.putSingle("X-Content-Type-Options", "nosniff");
    headers.putSingle("X-XSS-Protection", "1; mode=block");

    // HSTS
    headers.putSingle("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

    // CSP — script-src için 'unsafe-inline' kullanmayın, XSS korumasını etkisiz kılar;
    // bunun yerine nonce veya hash kullanın
    headers.putSingle("Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  }
}
```

## Denetim Loglama

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

// Resource içinde kullanım
@Path("/api/sensitive")
public class SensitiveResource {
  @Inject
  AuditService auditService;

  @GET
  @RolesAllowed("ADMIN")
  public Response getData() {
    auditService.logAccess("sensitive-data", "READ");
    return Response.ok(data).build();
  }
}
```

## Bağımlılık Güvenliği Taraması

```bash
# Maven
mvn org.owasp:dependency-check-maven:check

# Gradle
./gradlew dependencyCheckAnalyze

# Check Quarkus extensions
quarkus extension list --installable
```

## En İyi Uygulamalar

- Production'da her zaman HTTPS kullanın
- Stateless kimlik doğrulama için JWT veya OIDC etkinleştirin
- Bildirimsel yetkilendirme için `@RolesAllowed` kullanın
- Bean Validation ile tüm girişleri doğrulayın
- Parolaları BCrypt ile hash'leyin (asla düz metin saklamayın)
- Gizli bilgileri Vault veya ortam değişkenlerinde saklayın
- SQL injection'ı önlemek için parametreli sorgular kullanın
- Tüm yanıtlara güvenlik başlıkları ekleyin
- Genel endpoint'lerde rate limiting uygulayın
- Hassas işlemleri denetleyin
- Bağımlılıkları güncel tutun ve CVE için tarayın
- Programatik kontroller için SecurityIdentity kullanın
- Uygun CORS politikaları belirleyin
- Kimlik doğrulama ve yetkilendirme yollarını test edin
