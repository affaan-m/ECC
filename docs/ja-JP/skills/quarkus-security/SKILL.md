---
name: quarkus-security
description: Quarkus認証、認可、JWT/OIDC、RBAC、入力検証、CSRF、シークレット管理、依存関係セキュリティのセキュリティベストプラクティス。
origin: ECC
---

# Quarkus Security Review

認証、認可、入力検証によってQuarkusアプリケーションを保護するためのベストプラクティス。

## When to Activate

- 認証追加（JWT、OIDC、Basic認証）
- @RolesAllowedまたはSecurityIdentityで認可実装
- ユーザー入力検証（Bean Validation、カスタムバリデータ）
- CORS設定またはセキュリティヘッダー構成
- シークレット管理（Vault、環境変数、設定ソース）
- レート制限またはブルートフォース対策追加
- CVEの依存関係スキャン
- MicroProfile JWTまたはSmallRye JWT操作

## Authentication

### JWT Authentication

```java
// JWT で保護されたリソース
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

Configuration (application.properties):
```properties
mp.jwt.verify.publickey.location=publicKey.pem
mp.jwt.verify.issuer=https://auth.example.com

# OIDC
quarkus.oidc.auth-server-url=https://auth.example.com/realms/myrealm
quarkus.oidc.client-id=backend-service
quarkus.oidc.credentials.secret=${OIDC_SECRET}
```

### Custom Authentication Filter

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class CustomAuthFilter implements ContainerRequestFilter {

  @Inject
  SecurityIdentity identity;

  @Override
  public void filter(ContainerRequestContext requestContext) {
    String authHeader = requestContext.getHeaderString(HttpHeaders.AUTHORIZATION);

    // ヘッダーが無いまたは不正形式の場合は即座に拒否
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
    // トークン検証ロジック
    return true;
  }
}
```

## Authorization

### Role-Based Access Control

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
    // 所有権確認
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

### Programmatic Security

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

## Input Validation

### Bean Validation

```java
// 悪い例：検証なし
@POST
public Response createUser(UserDto dto) {
  return Response.ok(userService.create(dto)).build();
}

// 良い例：検証DTO
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

### Custom Validators

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

// 使用例
public record CreateUserDto(
    @ValidUsername String username,
    @NotBlank @Email String email
) {}
```

## SQL Injection Prevention

### Panache Active Record (Safe by Default)

```java
// 良い例：Panacheでのパラメータ化クエリ
List<User> users = User.list("email = ?1 and active = ?2", email, true);

Optional<User> user = User.find("username", username).firstResultOptional();

// 良い例：名前付きパラメータ
List<User> users = User.list("email = :email and age > :minAge",
    Parameters.with("email", email).and("minAge", 18));
```

### Native Queries (Use Parameters)

```java
// 悪い例：文字列連結
@Query(value = "SELECT * FROM users WHERE name = '" + name + "'", nativeQuery = true)

// 良い例：パラメータ化ネイティブクエリ
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

## Password Hashing

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

// サービスで使用
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

## CORS Configuration

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

## Secrets Management

```properties
# application.properties - シークレットはここに置かない

# 環境変数を使用
quarkus.datasource.username=${DB_USER}
quarkus.datasource.password=${DB_PASSWORD}
quarkus.oidc.credentials.secret=${OIDC_CLIENT_SECRET}

# またはVaultを使用
quarkus.vault.url=https://vault.example.com
quarkus.vault.authentication.kubernetes.role=my-role
```

### HashiCorp Vault Integration

```java
@ApplicationScoped
public class SecretService {

  @ConfigProperty(name = "api-key")
  String apiKey; // Vault から取得

  public String getSecret(String key) {
    return ConfigProvider.getConfig().getValue(key, String.class);
  }
}
```

## Rate Limiting

**セキュリティ注意**: `X-Forwarded-For` を直接使用しないでください — クライアントで偽装できます。
サーブレットリクエストからの実際のリモートアドレスを使用するか、利用可能な場合は認証ID（APIキー、JWTサブジェクト）を使用します。

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
        k -> RateLimiter.create(100.0)); // 1秒あたり100リクエスト

    if (!limiter.tryAcquire()) {
      requestContext.abortWith(
          Response.status(429)
              .entity(Map.of("error", "Too many requests"))
              .build()
      );
    }
  }

  private String getClientIdentifier() {
    // コンテナが提供するリモートアドレスを使用（X-Forwarded-Forではない）
    // 信頼されたプロキシの背後にある場合、quarkus.http.proxy.proxy-address-forwarding=trueを設定して
    // getRemoteAddr()が実クライアントIPを返すようにします
    return servletRequest.getRemoteAddr();
  }
}
```

## Security Headers

```java
@Provider
public class SecurityHeadersFilter implements ContainerResponseFilter {

  @Override
  public void filter(ContainerRequestContext request, ContainerResponseContext response) {
    MultivaluedMap<String, Object> headers = response.getHeaders();

    // クリックジャッキング防止
    headers.putSingle("X-Frame-Options", "DENY");

    // XSS保護
    headers.putSingle("X-Content-Type-Options", "nosniff");
    headers.putSingle("X-XSS-Protection", "1; mode=block");

    // HSTS
    headers.putSingle("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

    // CSP — script-src用の'unsafe-inline'は避けてください。XSS保護を無効化します。
    // 代わりにnoncesまたはhashesを使用します。CSSフレームワークが必要な場合、
    // style-srcの'unsafe-inline'は許容ですが、可能な場合はnoncesを優先してください。
    headers.putSingle("Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  }
}
```

## Audit Logging

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

// リソースでの使用
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

## Dependency Security Scanning

```bash
# Maven
mvn org.owasp:dependency-check-maven:check

# Gradle
./gradlew dependencyCheckAnalyze

# Quarkus拡張機能チェック
quarkus extension list --installable
```

## Best Practices

- 本番環境では常にHTTPSを使用
- ステートレス認証にはJWTまたはOIDCを有効化
- 宣言的認可に@RolesAllowedを使用
- Bean Validationで全入力検証
- BCryptでパスワードハッシュ化（プレーンテキスト厳禁）
- VaultまたはLambda環境変数でシークレット保存
- SQLインジェクション防止にパラメータ化クエリを使用
- 全レスポンスにセキュリティヘッダー追加
- 公開エンドポイントにレート制限実装
- 機密操作を監査ログに記録
- 依存関係を最新に保ちCVEスキャン実施
- プログラム的チェックにSecurityIdentityを使用
- 適切なCORSポリシー設定
- 認証・認可経路をテスト
