---
name: laravel-verification
description: "Verification loop for Laravel projects: env checks, linting, static analysis, tests with coverage, security scans, and deployment readiness."
origin: ECC
---

# Laravel Doğrulama Döngüsü

PR'lardan önce, büyük değişikliklerden sonra ve deployment öncesi çalıştırın.

## Ne Zaman Kullanılır

- Laravel projesi için pull request açmadan önce
- Büyük refactoring'ler veya bağımlılık yükseltmelerinden sonra
- Staging veya production için deployment öncesi doğrulama
- Tam lint -> test -> güvenlik -> deployment hazırlık pipeline'ı çalıştırma

## Nasıl Çalışır

- Her katmanın bir öncekinin üzerine inşa edilmesi için fazları sırayla ortam kontrollerinden deployment hazırlığına kadar çalıştırın.
- Ortam ve Composer kontrolleri her şeyi kapsar; başarısız olurlarsa hemen durun.
- Tam testleri ve kapsamı çalıştırmadan önce linting/static analiz temiz olmalıdır.
- Güvenlik ve migration incelemeleri testlerden sonra olur, böylece veri veya yayın adımlarından önce davranışı doğrularsınız.
- Build/deployment hazırlığı ve kuyruk/zamanlayıcı kontrolleri son kapılardır; herhangi bir başarısızlık yayını engeller.

## Faz 1: Ortam Kontrolleri

```bash
php -v
composer --version
php artisan --version
```

- `.env`'nin mevcut olduğunu ve gerekli anahtarların var olduğunu doğrulayın
- Production ortamları için `APP_DEBUG=false` onaylayın
- `APP_ENV`'in hedef deployment'la eşleştiğini onaylayın (`production`, `staging`)

Yerel olarak Laravel Sail kullanıyorsanız:

```bash
./vendor/bin/sail php -v
./vendor/bin/sail artisan --version
```

## Faz 1.5: Composer ve Autoload

```bash
composer validate
composer dump-autoload -o
```

## Faz 2: Linting ve Static Analiz

```bash
vendor/bin/pint --test
vendor/bin/phpstan analyse
```

Projeniz PHPStan yerine Psalm kullanıyorsa:

```bash
vendor/bin/psalm
```

## Faz 3: Testler ve Kapsam

```bash
php artisan test
```

Kapsam (CI):

```bash
XDEBUG_MODE=coverage php artisan test --coverage
```

CI örneği (format -> static analiz -> testler):

```bash
vendor/bin/pint --test
vendor/bin/phpstan analyse
XDEBUG_MODE=coverage php artisan test --coverage
```

## Faz 4: Güvenlik ve Bağımlılık Kontrolleri

```bash
composer audit
```

## Faz 5: Database ve Migration'lar

```bash
php artisan migrate --pretend
php artisan migrate:status
```

- Yıkıcı migration'ları dikkatle inceleyin
- Migration dosya isimlerinin `Y_m_d_His_*` formatını takip ettiğinden emin olun (örn. `2025_03_14_154210_create_orders_table.php`) ve değişikliği net bir şekilde açıklasın
- Rollback'lerin mümkün olduğundan emin olun
- `down()` metotlarını doğrulayın ve açık yedeklemeler olmadan geri alınamaz veri kaybından kaçının

## Faz 6: Build ve Deployment Hazırlığı

```bash
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

- Cache warmup'larının production yapılandırmasında başarılı olduğundan emin olun
- Kuyruk worker'larının ve zamanlayıcının yapılandırıldığını doğrulayın
- Hedef ortamda `storage/` ve `bootstrap/cache/`'in yazılabilir olduğunu onaylayın

## Faz 7: Kuyruk ve Zamanlayıcı Kontrolleri

```bash
php artisan schedule:list
php artisan queue:failed
```

Horizon kullanılıyorsa:

```bash
php artisan horizon:status
```

`queue:monitor` mevcutsa, job'ları işlemeden biriktirmeyi kontrol etmek için kullanın:

```bash
php artisan queue:monitor default --max=100
```

Aktif doğrulama (sadece staging): özel bir kuyruğa no-op job dispatch edin ve işlemek için tek bir worker çalıştırın (non-`sync` kuyruk bağlantısının yapılandırıldığından emin olun).

```bash
php artisan tinker --execute="dispatch((new App\\Jobs\\QueueHealthcheck())->onQueue('healthcheck'))"
php artisan queue:work --once --queue=healthcheck
```

Job'un beklenen yan etkiyi ürettiğini doğrulayın (log girişi, healthcheck tablo satırı veya metrik).

Bunu sadece test job'u işlemenin güvenli olduğu non-production ortamlarında çalıştırın.

## Örnekler

Minimal akış:

```bash
php -v
composer --version
php artisan --version
composer validate
vendor/bin/pint --test
vendor/bin/phpstan analyse
php artisan test
composer audit
php artisan migrate --pretend
php artisan config:cache
php artisan queue:failed
```

CI tarzı pipeline:

```bash
composer validate
composer dump-autoload -o
vendor/bin/pint --test
vendor/bin/phpstan analyse
XDEBUG_MODE=coverage php artisan test --coverage
composer audit
php artisan migrate --pretend
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan schedule:list
```
