---
name: springboot-verification
description: "Verification loop for Spring Boot projects: build, static analysis, tests with coverage, security scans, and diff review before release or PR."
origin: ECC
---

# Spring Boot Doğrulama Döngüsü

PR'lardan önce, büyük değişikliklerden sonra ve deployment öncesi çalıştırın.

## Ne Zaman Aktif Edilir

- Spring Boot servisi için pull request açmadan önce
- Büyük refactoring veya bağımlılık yükseltmelerinden sonra
- Staging veya production için deployment öncesi doğrulama
- Tam build → lint → test → güvenlik taraması pipeline'ı çalıştırma
- Test kapsamının eşikleri karşıladığını doğrulama

## Faz 1: Build

```bash
mvn -T 4 clean verify -DskipTests
# veya
./gradlew clean assemble -x test
```

Build başarısız olursa, durdurun ve düzeltin.

## Faz 2: Static Analiz

Maven (yaygın plugin'ler):
```bash
mvn -T 4 spotbugs:check pmd:check checkstyle:check
```

Gradle (yapılandırılmışsa):
```bash
./gradlew checkstyleMain pmdMain spotbugsMain
```

## Faz 3: Testler + Kapsam

```bash
mvn -T 4 test
mvn jacoco:report   # 80%+ kapsam doğrula
# veya
./gradlew test jacocoTestReport
```

Rapor:
- Toplam testler, geçen/başarısız
- Kapsam % (satırlar/dallar)

### Unit Testler

Mock bağımlılıklarla izole olarak servis mantığını test edin:

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

### Testcontainers ile Entegrasyon Testleri

H2 yerine gerçek bir veritabanına karşı test edin:

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

### MockMvc ile API Testleri

Tam Spring context ile controller katmanını test edin:

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

## Faz 4: Güvenlik Taraması

```bash
# Bağımlılık CVE'leri
mvn org.owasp:dependency-check-maven:check
# veya
./gradlew dependencyCheckAnalyze

# Kaynakta gizli bilgiler
grep -rn "password\s*=\s*\"" src/ --include="*.java" --include="*.yml" --include="*.properties"
grep -rn "sk-\|api_key\|secret" src/ --include="*.java" --include="*.yml"

# Gizli bilgiler (git geçmişi)
git secrets --scan  # yapılandırılmışsa
```

### Yaygın Güvenlik Bulguları

```
# System.out.println kontrolü (yerine logger kullan)
grep -rn "System\.out\.print" src/main/ --include="*.java"

# Yanıtlarda ham exception mesajları kontrolü
grep -rn "e\.getMessage()" src/main/ --include="*.java"

# Wildcard CORS kontrolü
grep -rn "allowedOrigins.*\*" src/main/ --include="*.java"
```

## Faz 5: Lint/Format (opsiyonel kapı)

```bash
mvn spotless:apply   # Spotless plugin kullanıyorsanız
./gradlew spotlessApply
```

## Faz 6: Diff İncelemesi

```bash
git diff --stat
git diff
```

Kontrol listesi:
- Debug logları kalmamış (`System.out`, koruma olmadan `log.debug`)
- Anlamlı hatalar ve HTTP durumları
- Gerekli yerlerde transaction'lar ve validation mevcut
- Config değişiklikleri belgelenmiş

## Çıktı Şablonu

```
DOĞRULAMA RAPORU
===================
Build:     [GEÇTİ/BAŞARISIZ]
Static:    [GEÇTİ/BAŞARISIZ] (spotbugs/pmd/checkstyle)
Testler:   [GEÇTİ/BAŞARISIZ] (X/Y geçti, Z% kapsam)
Güvenlik:  [GEÇTİ/BAŞARISIZ] (CVE bulguları: N)
Diff:      [X dosya değişti]

Genel:     [HAZIR / HAZIR DEĞİL]

Düzeltilecek Sorunlar:
1. ...
2. ...
```

## Sürekli Mod

- Önemli değişikliklerde veya uzun oturumlarda her 30-60 dakikada bir fazları yeniden çalıştırın
- Kısa döngü tutun: hızlı geri bildirim için `mvn -T 4 test` + spotbugs

**Unutmayın**: Hızlı geri bildirim geç sürprizleri yener. Kapıyı sıkı tutun—production sistemlerinde uyarıları kusur olarak değerlendirin.
