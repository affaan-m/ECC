---
name: quarkus-verification
description: "Verification loop for Quarkus projects: build, static analysis, tests with coverage, security scans, native compilation, and diff review before release or PR."
origin: ECC
---

# Quarkus Verification Loop

Run before PRs, after major changes, and pre-deploy.

## When to Activate

- Before opening a pull request for a Quarkus service
- After major refactoring or dependency upgrades
- Pre-deployment verification for staging or production
- Running full build → lint → test → security scan → native compilation pipeline
- Validating test coverage meets thresholds (80%+)
- Testing native image compatibility

## Phase 1: Build

```bash
# Maven
mvn clean verify -DskipTests

# Gradle
./gradlew clean assemble -x test
```

If build fails, stop and fix compilation errors.

## Phase 2: Static Analysis

### Checkstyle, PMD, SpotBugs (Maven)

```bash
mvn checkstyle:check pmd:check spotbugs:check
```

### SonarQube (if configured)

```bash
mvn sonar:sonar \
  -Dsonar.projectKey=my-quarkus-project \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.login=${SONAR_TOKEN}
```

### Common Issues to Address

- Unused imports or variables
- Complex methods (high cyclomatic complexity)
- Potential null pointer dereferences
- Security issues flagged by SpotBugs

## Phase 3: Tests + Coverage

```bash
# Run all tests
mvn clean test

# Generate coverage report
mvn jacoco:report

# Enforce coverage threshold (80%)
mvn jacoco:check

# Or with Gradle
./gradlew test jacocoTestReport jacocoTestCoverageVerification
```

### Test Categories

#### Unit Tests
Test service logic with mocked dependencies:

```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {
  @Mock UserRepository userRepository;
  @InjectMocks UserService userService;

  @Test
  void createUser_validInput_returnsUser() {
    var dto = new CreateUserDto("Alice", "alice@example.com");

    // Panache persist() is void — use doNothing + verify
    doNothing().when(userRepository).persist(any(User.class));

    User result = userService.create(dto);

    assertThat(result.name).isEqualTo("Alice");
    verify(userRepository).persist(any(User.class));
  }
}
```

#### Integration Tests
Test with real database (Testcontainers):

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

#### API Tests
Test REST endpoints with REST Assured:

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

### Coverage Report

Check `target/site/jacoco/index.html` for detailed coverage:
- Overall line coverage (target: 80%+)
- Branch coverage (target: 70%+)
- Identify uncovered critical paths

## Phase 4: Security Scanning

### Dependency Vulnerabilities (Maven)

```bash
mvn org.owasp:dependency-check-maven:check
```

Review `target/dependency-check-report.html` for CVEs.

### Quarkus Security Audit

```bash
# Check vulnerable extensions
mvn quarkus:audit

# List all extensions
mvn quarkus:list-extensions
```

### OWASP ZAP (API Security Testing)

```bash
docker run -t owasp/zap2docker-stable zap-api-scan.py \
  -t http://localhost:8080/q/openapi \
  -f openapi
```

### Common Security Checks

- [ ] All secrets in environment variables (not in code)
- [ ] Input validation on all endpoints
- [ ] Authentication/authorization configured
- [ ] CORS properly configured
- [ ] Security headers set
- [ ] Passwords hashed with BCrypt
- [ ] SQL injection protection (parameterized queries)
- [ ] Rate limiting on public endpoints

## Phase 5: Native Compilation

Test GraalVM native image compatibility:

```bash
# Build native executable
mvn package -Dnative

# Or with container
mvn package -Dnative -Dquarkus.native.container-build=true

# Test native executable
./target/*-runner

# Run basic smoke tests
curl http://localhost:8080/q/health/live
curl http://localhost:8080/q/health/ready
```

### Native Image Troubleshooting

Common issues:
- **Reflection**: Add reflection config for dynamic classes
- **Resources**: Include resources with `quarkus.native.resources.includes`
- **JNI**: Register JNI classes if using native libraries

Example reflection config:
```java
@RegisterForReflection(targets = {MyDynamicClass.class})
public class ReflectionConfiguration {}
```

## Phase 6: Performance Testing

### Load Testing with K6

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

Run:
```bash
k6 run load-test.js
```

### Metrics to Monitor

- Response time (p50, p95, p99)
- Throughput (requests/sec)
- Error rate
- Memory usage
- CPU usage

## Phase 7: Health Checks

```bash
# Liveness
curl http://localhost:8080/q/health/live

# Readiness
curl http://localhost:8080/q/health/ready

# All health checks
curl http://localhost:8080/q/health

# Metrics (if enabled)
curl http://localhost:8080/q/metrics
```

Expected responses:
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

## Phase 8: Container Image Build

```bash
# Build container image
mvn package -Dquarkus.container-image.build=true

# Or with specific registry
mvn package \
  -Dquarkus.container-image.build=true \
  -Dquarkus.container-image.registry=docker.io \
  -Dquarkus.container-image.group=myorg \
  -Dquarkus.container-image.tag=1.0.0

# Test container
docker run -p 8080:8080 myorg/my-quarkus-app:1.0.0
```

### Container Security Scan

```bash
# Trivy
trivy image myorg/my-quarkus-app:1.0.0

# Grype
grype myorg/my-quarkus-app:1.0.0
```

## Phase 9: Configuration Validation

```bash
# Check all configuration properties
mvn quarkus:info

# List all config sources
curl http://localhost:8080/q/dev/io.quarkus.quarkus-vertx-http/config
```

### Environment-Specific Checks

- [ ] Database URLs configured per environment
- [ ] Secrets externalized (Vault, env vars)
- [ ] Logging levels appropriate
- [ ] CORS origins set correctly
- [ ] Rate limiting configured
- [ ] Monitoring/tracing enabled

## Phase 10: Documentation Review

- [ ] OpenAPI/Swagger docs up to date (`/q/swagger-ui`)
- [ ] README has setup instructions
- [ ] API changes documented
- [ ] Migration guide for breaking changes
- [ ] Configuration properties documented

Generate OpenAPI spec:
```bash
curl http://localhost:8080/q/openapi -o openapi.json
```

## Verification Checklist

### Code Quality
- [ ] Build passes without warnings
- [ ] Static analysis clean (no high/medium issues)
- [ ] Code follows team conventions
- [ ] No commented-out code or TODOs in PR

### Testing
- [ ] All tests pass
- [ ] Code coverage ≥ 80%
- [ ] Integration tests with real database
- [ ] Security tests pass
- [ ] Performance within acceptable limits

### Security
- [ ] No dependency vulnerabilities
- [ ] Authentication/authorization tested
- [ ] Input validation complete
- [ ] Secrets not in source code
- [ ] Security headers configured

### Deployment
- [ ] Native compilation successful
- [ ] Container image builds
- [ ] Health checks respond correctly
- [ ] Configuration valid for target environment

### Native Image
- [ ] Native executable builds
- [ ] Native tests pass
- [ ] Startup time < 100ms
- [ ] Memory footprint acceptable

## Automated Verification Script

```bash
#!/bin/bash
set -e

echo "=== Phase 1: Build ==="
mvn clean verify -DskipTests

echo "=== Phase 2: Static Analysis ==="
mvn checkstyle:check pmd:check spotbugs:check

echo "=== Phase 3: Tests + Coverage ==="
mvn test jacoco:report jacoco:check

echo "=== Phase 4: Security Scan ==="
mvn org.owasp:dependency-check-maven:check

echo "=== Phase 5: Native Compilation ==="
mvn package -Dnative -Dquarkus.native.container-build=true

echo "=== All Phases Complete ==="
echo "Review reports:"
echo "  - Coverage: target/site/jacoco/index.html"
echo "  - Security: target/dependency-check-report.html"
echo "  - Native: target/*-runner"
```

## CI/CD Integration

### GitHub Actions Example

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

## Best Practices

- Run verification loop before every PR
- Automate in CI/CD pipeline
- Fix issues immediately; don't accumulate debt
- Keep coverage above 80%
- Update dependencies regularly
- Test native compilation periodically
- Monitor performance trends
- Document breaking changes
- Review security scan results
- Validate configuration for each environment
