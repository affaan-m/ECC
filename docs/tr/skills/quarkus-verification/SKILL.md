---
name: quarkus-verification
description: "Verification loop for Quarkus projects: build, static analysis, tests with coverage, security scans, native compilation, and diff review before release or PR."
origin: ECC
---

# Quarkus Doğrulama Döngüsü

PR'lardan önce, büyük değişikliklerden sonra ve deployment öncesi çalıştırın.

## Ne Zaman Aktif Edilir

- Quarkus servisi için pull request açmadan önce
- Büyük refactoring veya bağımlılık yükseltmelerinden sonra
- Staging veya production için deployment öncesi doğrulama
- Tam build → lint → test → güvenlik taraması → native derleme pipeline'ı çalıştırma
- Test kapsamının eşikleri karşıladığını doğrulama (%80+)
- Native image uyumluluğunu test etme

## Faz 1: Build

```bash
# Maven
mvn clean verify -DskipTests

# Gradle
./gradlew clean assemble -x test
```

Build başarısız olursa, durdurun ve derleme hatalarını düzeltin.

## Faz 2: Static Analiz

### Checkstyle, PMD, SpotBugs (Maven)

```bash
mvn checkstyle:check pmd:check spotbugs:check
```

### SonarQube (yapılandırılmışsa)

```bash
mvn sonar:sonar \
  -Dsonar.projectKey=my-quarkus-project \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.login=${SONAR_TOKEN}
```

### Ele Alınacak Yaygın Sorunlar

- Kullanılmayan import'lar veya değişkenler
- Karmaşık metodlar (yüksek cyclomatic complexity)
- Potansiyel null pointer dereference'ları
- SpotBugs tarafından işaretlenen güvenlik sorunları

## Faz 3: Testler + Kapsam

```bash
# Tüm testleri çalıştır
mvn clean test

# Kapsam raporu oluştur
mvn jacoco:report

# Kapsam eşiğini zorla (%80)
mvn jacoco:check

# Veya Gradle ile
./gradlew test jacocoTestReport jacocoTestCoverageVerification
```

### Test Kategorileri

#### Unit Testler
Mock'lanmış bağımlılıklarla servis mantığını test edin:

```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {
  @Mock UserRepository userRepository;
  @InjectMocks UserService userService;

  @Test
  void createUser_validInput_returnsUser() {
    var dto = new CreateUserDto("Alice", "alice@example.com");

    // Panache persist() void döndürür — doNothing + verify kullanın
    doNothing().when(userRepository).persist(any(User.class));

    User result = userService.create(dto);

    assertThat(result.name).isEqualTo("Alice");
    verify(userRepository).persist(any(User.class));
  }
}
```

#### Entegrasyon Testleri
Gerçek veritabanıyla (Testcontainers) test edin:

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

#### API Testleri
REST Assured ile REST endpoint'lerini test edin:

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

### Kapsam Raporu

Ayrıntılı kapsam için `target/site/jacoco/index.html` sayfasını kontrol edin:
- Genel satır kapsamı (hedef: %80+)
- Branch kapsamı (hedef: %70+)
- Kapsanmamış kritik yolları belirleyin

## Faz 4: Güvenlik Taraması

### Bağımlılık Güvenlik Açıkları (Maven)

```bash
mvn org.owasp:dependency-check-maven:check
```

CVE'ler için `target/dependency-check-report.html` raporunu inceleyin.

### Quarkus Güvenlik Denetimi

```bash
# Güvenlik açığı olan extension'ları kontrol et
mvn quarkus:audit

# Tüm extension'ları listele
mvn quarkus:list-extensions
```

### OWASP ZAP (API Güvenlik Testi)

```bash
docker run -t owasp/zap2docker-stable zap-api-scan.py \
  -t http://localhost:8080/q/openapi \
  -f openapi
```

### Yaygın Güvenlik Kontrolleri

- [ ] Tüm gizli bilgiler ortam değişkenlerinde (kodda değil)
- [ ] Tüm endpoint'lerde girdi doğrulama
- [ ] Kimlik doğrulama/yetkilendirme yapılandırılmış
- [ ] CORS düzgün yapılandırılmış
- [ ] Güvenlik başlıkları ayarlanmış
- [ ] Parolalar BCrypt ile hash'lenmiş
- [ ] SQL injection koruması (parametreli sorgular)
- [ ] Genel endpoint'lerde rate limiting

## Faz 5: Native Derleme

GraalVM native image uyumluluğunu test edin:

```bash
# Native executable oluştur
mvn package -Dnative

# Veya container ile
mvn package -Dnative -Dquarkus.native.container-build=true

# Native executable'ı test et
./target/*-runner

# Temel smoke testleri çalıştır
curl http://localhost:8080/q/health/live
curl http://localhost:8080/q/health/ready
```

### Native Image Sorun Giderme

Yaygın sorunlar:
- **Reflection**: Dinamik sınıflar için reflection yapılandırması ekleyin
- **Resources**: `quarkus.native.resources.includes` ile kaynakları dahil edin
- **JNI**: Native kütüphaneler kullanıyorsanız JNI sınıflarını kaydedin

Örnek reflection yapılandırması:
```java
@RegisterForReflection(targets = {MyDynamicClass.class})
public class ReflectionConfiguration {}
```

## Faz 6: Performans Testi

### K6 ile Yük Testi

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

Çalıştırın:
```bash
k6 run load-test.js
```

### İzlenecek Metrikler

- Yanıt süresi (p50, p95, p99)
- Throughput (istek/saniye)
- Hata oranı
- Bellek kullanımı
- CPU kullanımı

## Faz 7: Sağlık Kontrolleri

```bash
# Liveness
curl http://localhost:8080/q/health/live

# Readiness
curl http://localhost:8080/q/health/ready

# Tüm sağlık kontrolleri
curl http://localhost:8080/q/health

# Metrikler (etkinleştirilmişse)
curl http://localhost:8080/q/metrics
```

Beklenen yanıtlar:
```json
{
  "status": "UP",
  "checks": [
    {
      "name": "Database connection",
      "status": "UP"
    }
  ]
}
```

## Faz 8: Container Image Build

```bash
# Container image oluştur
mvn package -Dquarkus.container-image.build=true

# Veya belirli registry ile
mvn package \
  -Dquarkus.container-image.build=true \
  -Dquarkus.container-image.registry=docker.io \
  -Dquarkus.container-image.group=myorg \
  -Dquarkus.container-image.tag=1.0.0

# Container'ı test et
docker run -p 8080:8080 myorg/my-quarkus-app:1.0.0
```

### Container Güvenlik Taraması

```bash
# Trivy
trivy image myorg/my-quarkus-app:1.0.0

# Grype
grype myorg/my-quarkus-app:1.0.0
```

## Faz 9: Yapılandırma Doğrulama

```bash
# Tüm yapılandırma özelliklerini kontrol et
mvn quarkus:info

# Tüm yapılandırma kaynaklarını listele
curl http://localhost:8080/q/dev/io.quarkus.quarkus-vertx-http/config
```

### Ortama Özgü Kontroller

- [ ] Veritabanı URL'leri ortam başına yapılandırılmış
- [ ] Gizli bilgiler dışsallaştırılmış (Vault, ortam değişkenleri)
- [ ] Loglama seviyeleri uygun
- [ ] CORS origin'leri doğru ayarlanmış
- [ ] Rate limiting yapılandırılmış
- [ ] İzleme/tracing etkinleştirilmiş

## Faz 10: Dokümantasyon İncelemesi

- [ ] OpenAPI/Swagger dokümanları güncel (`/q/swagger-ui`)
- [ ] README kurulum talimatlarını içeriyor
- [ ] API değişiklikleri belgelenmiş
- [ ] Breaking change'ler için migration rehberi
- [ ] Yapılandırma özellikleri belgelenmiş

OpenAPI spec oluşturun:
```bash
curl http://localhost:8080/q/openapi -o openapi.json
```

## Doğrulama Kontrol Listesi

### Kod Kalitesi
- [ ] Build uyarısız geçiyor
- [ ] Static analiz temiz (yüksek/orta sorun yok)
- [ ] Kod ekip kurallarını takip ediyor
- [ ] PR'da yorum satırına alınmış kod veya TODO yok

### Test
- [ ] Tüm testler geçiyor
- [ ] Kod kapsamı ≥ %80
- [ ] Gerçek veritabanıyla entegrasyon testleri
- [ ] Güvenlik testleri geçiyor
- [ ] Performans kabul edilebilir sınırlar içinde

### Güvenlik
- [ ] Bağımlılık güvenlik açığı yok
- [ ] Kimlik doğrulama/yetkilendirme test edilmiş
- [ ] Girdi doğrulama tamamlanmış
- [ ] Gizli bilgiler kaynak kodda değil
- [ ] Güvenlik başlıkları yapılandırılmış

### Deployment
- [ ] Native derleme başarılı
- [ ] Container image oluşturuluyor
- [ ] Sağlık kontrolleri doğru yanıt veriyor
- [ ] Hedef ortam için yapılandırma geçerli

### Native Image
- [ ] Native executable oluşturuluyor
- [ ] Native testler geçiyor
- [ ] Başlangıç süresi < 100ms
- [ ] Bellek ayak izi kabul edilebilir

## Otomatik Doğrulama Script'i

```bash
#!/bin/bash
set -e

echo "=== Faz 1: Build ==="
mvn clean verify -DskipTests

echo "=== Faz 2: Static Analiz ==="
mvn checkstyle:check pmd:check spotbugs:check

echo "=== Faz 3: Testler + Kapsam ==="
mvn test jacoco:report jacoco:check

echo "=== Faz 4: Güvenlik Taraması ==="
mvn org.owasp:dependency-check-maven:check

echo "=== Faz 5: Native Derleme ==="
mvn package -Dnative -Dquarkus.native.container-build=true

echo "=== Tüm Fazlar Tamamlandı ==="
echo "Raporları inceleyin:"
echo "  - Kapsam: target/site/jacoco/index.html"
echo "  - Güvenlik: target/dependency-check-report.html"
echo "  - Native: target/*-runner"
```

## CI/CD Entegrasyonu

### GitHub Actions Örneği

```yaml
name: Verification

on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up JDK 21
        uses: actions/setup-java@v3
        with:
          java-version: '21'
          distribution: 'temurin'

      - name: Cache Maven packages
        uses: actions/cache@v3
        with:
          path: ~/.m2
          key: ${{ runner.os }}-m2-${{ hashFiles('**/pom.xml') }}

      - name: Build
        run: mvn clean verify -DskipTests

      - name: Test with Coverage
        run: mvn test jacoco:report jacoco:check

      - name: Security Scan
        run: mvn org.owasp:dependency-check-maven:check

      - name: Upload Coverage
        uses: codecov/codecov-action@v3
        with:
          files: target/site/jacoco/jacoco.xml
```

## En İyi Uygulamalar

- Her PR öncesi doğrulama döngüsünü çalıştırın
- CI/CD pipeline'ında otomatize edin
- Sorunları hemen düzeltin; borç biriktirmeyin
- Kapsamı %80'in üzerinde tutun
- Bağımlılıkları düzenli olarak güncelleyin
- Native derlemeyi periyodik olarak test edin
- Performans trendlerini izleyin
- Breaking change'leri belgeleyin
- Güvenlik tarama sonuçlarını inceleyin
- Her ortam için yapılandırmayı doğrulayın
