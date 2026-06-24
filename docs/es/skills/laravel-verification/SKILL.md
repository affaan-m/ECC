---
name: laravel-verification
description: "Bucle de verificación para proyectos Laravel: verificaciones de entorno, linting, análisis estático, pruebas con cobertura, escaneos de seguridad y preparación para despliegue."
origin: ECC
---

# Bucle de Verificación Laravel

Ejecutar antes de PRs, después de cambios importantes y antes del despliegue.

## Cuándo Usar

- Antes de abrir un pull request para un proyecto Laravel
- Después de refactorizaciones importantes o actualizaciones de dependencias
- Verificación previa al despliegue para staging o producción
- Ejecutar el pipeline completo de lint -> prueba -> seguridad -> preparación para despliegue

## Cómo Funciona

- Ejecutar las fases secuencialmente desde las verificaciones de entorno hasta la preparación para despliegue, de modo que cada capa construya sobre la anterior.
- Las verificaciones de entorno y Composer son requisitos previos para todo lo demás; detener inmediatamente si fallan.
- El linting/análisis estático debe estar limpio antes de ejecutar pruebas completas y cobertura.
- Las revisiones de seguridad y migraciones ocurren después de las pruebas para verificar el comportamiento antes de los pasos de datos o lanzamiento.
- La preparación de build/despliegue y las verificaciones de cola/scheduler son los últimos filtros; cualquier fallo bloquea el lanzamiento.

## Fase 1: Verificaciones de Entorno

```bash
php -v
composer --version
php artisan --version
```

- Verificar que `.env` esté presente y que las claves requeridas existan
- Confirmar `APP_DEBUG=false` para entornos de producción
- Confirmar que `APP_ENV` coincida con el despliegue objetivo (`production`, `staging`)

Si se usa Laravel Sail localmente:

```bash
./vendor/bin/sail php -v
./vendor/bin/sail artisan --version
```

## Fase 1.5: Composer y Autoload

```bash
composer validate
composer dump-autoload -o
```

## Fase 2: Linting y Análisis Estático

```bash
vendor/bin/pint --test
vendor/bin/phpstan analyse
```

Si el proyecto usa Psalm en lugar de PHPStan:

```bash
vendor/bin/psalm
```

## Fase 3: Pruebas y Cobertura

```bash
php artisan test
```

Cobertura (CI):

```bash
XDEBUG_MODE=coverage php artisan test --coverage
```

Ejemplo de pipeline CI (formato -> análisis estático -> pruebas):

```bash
vendor/bin/pint --test
vendor/bin/phpstan analyse
XDEBUG_MODE=coverage php artisan test --coverage
```

## Fase 4: Seguridad y Verificación de Dependencias

```bash
composer audit
```

## Fase 5: Base de Datos y Migraciones

```bash
php artisan migrate --pretend
php artisan migrate:status
```

- Revisar cuidadosamente las migraciones destructivas
- Asegurarse de que los nombres de archivo de migración sigan el formato `Y_m_d_His_*` (ej. `2025_03_14_154210_create_orders_table.php`) y describan el cambio claramente
- Asegurarse de que los rollbacks sean posibles
- Verificar los métodos `down()` y evitar la pérdida irreversible de datos sin copias de seguridad explícitas

## Fase 6: Preparación de Build y Despliegue

```bash
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

- Asegurarse de que los warmups de caché tengan éxito en la configuración de producción
- Verificar que los workers de cola y el scheduler estén configurados
- Confirmar que `storage/` y `bootstrap/cache/` sean escribibles en el entorno objetivo

## Fase 7: Verificaciones de Cola y Scheduler

```bash
php artisan schedule:list
php artisan queue:failed
```

Si se usa Horizon:

```bash
php artisan horizon:status
```

Si `queue:monitor` está disponible, usarlo para verificar el backlog sin procesar jobs:

```bash
php artisan queue:monitor default --max=100
```

Verificación activa (solo staging): despachar un job no-op a una cola dedicada y ejecutar un solo worker para procesarlo (asegurarse de que esté configurada una conexión de cola que no sea `sync`).

```bash
php artisan tinker --execute="dispatch((new App\\Jobs\\QueueHealthcheck())->onQueue('healthcheck'))"
php artisan queue:work --once --queue=healthcheck
```

Verificar que el job produjera el efecto secundario esperado (entrada de log, fila en tabla de healthcheck o métrica).

Ejecutar esto solo en entornos que no sean producción donde procesar un job de prueba sea seguro.

## Ejemplos

Flujo mínimo:

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

Pipeline estilo CI:

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
