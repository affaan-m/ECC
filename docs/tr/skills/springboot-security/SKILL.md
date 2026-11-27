---
name: springboot-security
description: Spring Security best practices for authn/authz, validation, CSRF, secrets, headers, rate limiting, and dependency security in Java Spring Boot services.
origin: ECC
---

# Spring Boot Güvenlik İncelemesi

Auth ekleme, girişi işleme, endpoint oluşturma veya gizli bilgilerle uğraşırken kullanın.

## Ne Zaman Aktif Edilir

- Kimlik doğrulama ekleme (JWT, OAuth2, session-based)
- Yetkilendirme uygulama (@PreAuthorize, role-based erişim)
- Kullanıcı girişini doğrulama (Bean Validation, custom validator'lar)
- CORS, CSRF veya güvenlik başlıklarını yapılandırma
- Gizli bilgileri yönetme (Vault, ortam değişkenleri)
- Rate limiting veya brute-force koruması ekleme
- Bağımlılıkları CVE için tarama

## Kimlik Doğrulama

- İptal listesi ile stateless JWT veya opaque token'ları tercih edin
- Session'lar için `httpOnly`, `Secure`, `SameSite=Strict` cookie'leri kullanın
- Token'ları `OncePerRequestFilter` veya resource server ile doğrulayın

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

## Yetkilendirme

- Method güvenliğini etkinleştirin: `@EnableMethodSecurity`
- `@PreAuthorize("hasRole('ADMIN')")` veya `@PreAuthorize("@authz.canEdit(#id)")` kullanın
- Varsayılan olarak reddedin; sadece gerekli scope'ları açığa çıkarın

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

## Girdi Doğrulama

- Controller'larda `@Valid` ile Bean Validation kullanın
- DTO'lara kısıtlamalar uygulayın: `@NotBlank`, `@Email`, `@Size`, custom validator'lar
- Render etmeden önce herhangi bir HTML'i whitelist ile temizleyin

```java
// KÖTÜ: Validation yok
@PostMapping("/users")
public User createUser(@RequestBody UserDto dto) {
  return userService.create(dto);
}

// İYİ: Doğrulanmış DTO
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

## SQL Injection Önleme

- Spring Data repository'leri veya parametreli sorgular kullanın
- Native sorgular için `:param` binding'leri kullanın; string'leri asla birleştirmeyin

```java
// KÖTÜ: Native sorguda string birleştirme
@Query(value = "SELECT * FROM users WHERE name = '" + name + "'", nativeQuery = true)

// İYİ: Parametreli native sorgu
@Query(value = "SELECT * FROM users WHERE name = :name", nativeQuery = true)
List<User> findByName(@Param("name") String name);

// İYİ: Spring Data türetilmiş sorgu (otomatik parametreli)
List<User> findByEmailAndActiveTrue(String email);
```

## Parola Kodlama

- Parolaları her zaman BCrypt veya Argon2 ile hash'leyin — asla düz metin saklamayın
- Manuel hash'leme değil `PasswordEncoder` bean'i kullanın

```java
@Bean
public PasswordEncoder passwordEncoder() {
  return new BCryptPasswordEncoder(12); // cost faktörü 12
}

// Servis içinde
public User register(CreateUserDto dto) {
  String hashedPassword = passwordEncoder.encode(dto.password());
  return userRepository.save(new User(dto.email(), hashedPassword));
}
```

## CSRF Koruması

- Tarayıcı session uygulamaları için CSRF'i etkin tutun; formlara/başlıklara token ekleyin
- Bearer token'lı saf API'ler için CSRF'i devre dışı bırakın ve stateless auth'a güvenin

```java
http
  .csrf(csrf -> csrf.disable())
  .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
```

## Gizli Bilgi Yönetimi

- Kaynak kodda gizli bilgi yok; env veya vault'tan yükleyin
- `application.yml`'i kimlik bilgilerinden arınmış tutun; yer tutucular kullanın
- Token'ları ve DB kimlik bilgilerini düzenli olarak döndürün

```yaml
# KÖTÜ: application.yml'de sabit kodlanmış
spring:
  datasource:
    password: mySecretPassword123

# İYİ: Ortam değişkeni yer tutucu
spring:
  datasource:
    password: ${DB_PASSWORD}

# İYİ: Spring Cloud Vault entegrasyonu
spring:
  cloud:
    vault:
      uri: https://vault.example.com
      token: ${VAULT_TOKEN}
```

## Güvenlik Başlıkları

```java
http
  .headers(headers -> headers
    .contentSecurityPolicy(csp -> csp
      .policyDirectives("default-src 'self'"))
    .frameOptions(HeadersConfigurer.FrameOptionsConfig::sameOrigin)
    .xssProtection(Customizer.withDefaults())
    .referrerPolicy(rp -> rp.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)));
```

## CORS Yapılandırması

- CORS'u controller başına değil, güvenlik filtre seviyesinde yapılandırın
- İzin verilen origin'leri kısıtlayın — production'da asla `*` kullanmayın

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

// SecurityFilterChain içinde:
http.cors(cors -> cors.configurationSource(corsConfigurationSource()));
```

## Rate Limiting

- Pahalı endpoint'lerde Bucket4j veya gateway seviyesi limitler uygulayın
- Patlamalarda logla ve uyar; yeniden deneme ipuçları ile 429 döndür

```java
// Endpoint başına rate limiting için Bucket4j kullanma
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

## Bağımlılık Güvenliği

- CI'da OWASP Dependency Check / Snyk çalıştırın
- Spring Boot ve Spring Security'yi desteklenen sürümlerde tutun
- Bilinen CVE'lerde build'leri başarısız yapın

## Loglama ve PII

- Gizli bilgileri, token'ları, parolaları veya tam PAN verilerini asla loglamayın
- Hassas alanları redakte edin; yapılandırılmış JSON loglama kullanın

## Dosya Yüklemeleri

- Boyutu, content type'ı ve uzantıyı doğrulayın
- Web root dışında saklayın; gerekirse tarayın

## Yayın Öncesi Kontrol Listesi

- [ ] Auth token'ları doğru şekilde doğrulanmış ve süresi dolmuş
- [ ] Her hassas path'te yetkilendirme korumaları
- [ ] Tüm girişler doğrulanmış ve temizlenmiş
- [ ] String-birleştirilmiş SQL yok
- [ ] Uygulama türü için doğru CSRF duruşu
- [ ] Gizli bilgiler harici; hiçbiri commit edilmemiş
- [ ] Güvenlik başlıkları yapılandırılmış
- [ ] API'lerde rate limiting
- [ ] Bağımlılıklar taranmış ve güncel
- [ ] Loglar hassas verilerden arınmış

**Unutmayın**: Varsayılan olarak reddet, girişleri doğrula, en az ayrıcalık ve önce yapılandırma ile güvenli.
