---
name: database-migrations
description: Buenas prácticas de migración de base de datos para cambios de esquema, migraciones de datos, rollbacks y despliegues de tiempo cero en PostgreSQL, MySQL y ORMs comunes (Prisma, Drizzle, Kysely, Django, TypeORM, golang-migrate).
origin: ECC
---

# Patrones de Migración de Base de Datos

Cambios de esquema de base de datos seguros y reversibles para sistemas de producción.

## Cuándo Activar

- Crear o alterar tablas de base de datos
- Agregar/eliminar columnas o índices
- Ejecutar migraciones de datos (backfill, transformación)
- Planificar cambios de esquema de tiempo cero (zero-downtime)
- Configurar herramientas de migración para un nuevo proyecto

## Principios Fundamentales

1. **Cada cambio es una migración** — nunca alterar bases de datos de producción manualmente
2. **Las migraciones son solo hacia adelante en producción** — los rollbacks usan nuevas migraciones hacia adelante
3. **Las migraciones de esquema y de datos son separadas** — nunca mezclar DDL y DML en una migración
4. **Probar migraciones contra datos de tamaño de producción** — una migración que funciona en 100 filas puede bloquear en 10M
5. **Las migraciones son inmutables una vez desplegadas** — nunca editar una migración que ya se ejecutó en producción

## Lista de Verificación de Seguridad de Migración

Antes de aplicar cualquier migración:

- [ ] La migración tiene tanto UP como DOWN (o está marcada explícitamente como irreversible)
- [ ] Sin bloqueos de tabla completa en tablas grandes (usar operaciones concurrentes)
- [ ] Las nuevas columnas tienen valores predeterminados o son nullable (nunca agregar NOT NULL sin valor predeterminado)
- [ ] Índices creados de forma concurrente (no en línea con CREATE TABLE para tablas existentes)
- [ ] El backfill de datos es una migración separada del cambio de esquema
- [ ] Probado contra una copia de datos de producción
- [ ] Plan de rollback documentado

## Patrones PostgreSQL

### Agregar una Columna de Forma Segura

```sql
-- BIEN: Columna nullable, sin bloqueo
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- BIEN: Columna con valor predeterminado (Postgres 11+ es instantáneo, sin reescritura)
ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- MAL: NOT NULL sin valor predeterminado en tabla existente (requiere reescritura completa)
ALTER TABLE users ADD COLUMN role TEXT NOT NULL;
-- Esto bloquea la tabla y reescribe cada fila
```

### Agregar un Índice Sin Tiempo de Inactividad

```sql
-- MAL: Bloquea escrituras en tablas grandes
CREATE INDEX idx_users_email ON users (email);

-- BIEN: No bloqueante, permite escrituras concurrentes
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);

-- Nota: CONCURRENTLY no puede ejecutarse dentro de un bloque de transacción
-- La mayoría de herramientas de migración necesitan manejo especial para esto
```

### Renombrar una Columna (Zero-Downtime)

Nunca renombrar directamente en producción. Usar el patrón expand-contract:

```sql
-- Paso 1: Agregar nueva columna (migración 001)
ALTER TABLE users ADD COLUMN display_name TEXT;

-- Paso 2: Backfill de datos (migración 002, migración de datos)
UPDATE users SET display_name = username WHERE display_name IS NULL;

-- Paso 3: Actualizar el código de la aplicación para leer/escribir ambas columnas
-- Desplegar cambios de aplicación

-- Paso 4: Dejar de escribir en la columna antigua, eliminarla (migración 003)
ALTER TABLE users DROP COLUMN username;
```

### Eliminar una Columna de Forma Segura

```sql
-- Paso 1: Eliminar todas las referencias de la aplicación a la columna
-- Paso 2: Desplegar la aplicación sin la referencia a la columna
-- Paso 3: Eliminar la columna en la próxima migración
ALTER TABLE orders DROP COLUMN legacy_status;

-- Para Django: usar SeparateDatabaseAndState para eliminar del modelo
-- sin generar DROP COLUMN (luego eliminar en la próxima migración)
```

### Migraciones de Datos Grandes

```sql
-- MAL: Actualiza todas las filas en una transacción (bloquea la tabla)
UPDATE users SET normalized_email = LOWER(email);

-- BIEN: Actualización en lotes con progreso
DO $$
DECLARE
  batch_size INT := 10000;
  rows_updated INT;
BEGIN
  LOOP
    UPDATE users
    SET normalized_email = LOWER(email)
    WHERE id IN (
      SELECT id FROM users
      WHERE normalized_email IS NULL
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RAISE NOTICE 'Updated % rows', rows_updated;
    EXIT WHEN rows_updated = 0;
    COMMIT;
  END LOOP;
END $$;
```

## Prisma (TypeScript/Node.js)

### Flujo de Trabajo

```bash
# Crear migración a partir de cambios de esquema
npx prisma migrate dev --name add_user_avatar

# Aplicar migraciones pendientes en producción
npx prisma migrate deploy

# Resetear base de datos (solo desarrollo)
npx prisma migrate reset

# Generar cliente después de cambios de esquema
npx prisma generate
```

### Ejemplo de Esquema

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  avatarUrl String?  @map("avatar_url")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  orders    Order[]

  @@map("users")
  @@index([email])
}
```

### Migración SQL Personalizada

Para operaciones que Prisma no puede expresar (índices concurrentes, backfills de datos):

```bash
# Crear migración vacía, luego editar el SQL manualmente
npx prisma migrate dev --create-only --name add_email_index
```

```sql
-- migrations/20240115_add_email_index/migration.sql
-- Prisma no puede generar CONCURRENTLY, por lo que se escribe manualmente
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
```

## Drizzle (TypeScript/Node.js)

### Flujo de Trabajo

```bash
# Generar migración a partir de cambios de esquema
npx drizzle-kit generate

# Aplicar migraciones
npx drizzle-kit migrate

# Hacer push del esquema directamente (solo desarrollo, sin archivo de migración)
npx drizzle-kit push
```

### Ejemplo de Esquema

```typescript
import { pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

## Kysely (TypeScript/Node.js)

### Flujo de Trabajo (kysely-ctl)

```bash
# Inicializar archivo de configuración (kysely.config.ts)
kysely init

# Crear un nuevo archivo de migración
kysely migrate make add_user_avatar

# Aplicar todas las migraciones pendientes
kysely migrate latest

# Revertir la última migración
kysely migrate down

# Mostrar estado de migraciones
kysely migrate list
```

### Archivo de Migración

```typescript
// migrations/2024_01_15_001_create_user_profile.ts
import { type Kysely, sql } from 'kysely'

// IMPORTANTE: Siempre usar Kysely<any>, no tu interfaz de DB tipada.
// Las migraciones están congeladas en el tiempo y no deben depender de los tipos de esquema actuales.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('user_profile')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('avatar_url', 'text')
    .addColumn('created_at', 'timestamp', (col) =>
      col.defaultTo(sql`now()`).notNull()
    )
    .execute()

  await db.schema
    .createIndex('idx_user_profile_avatar')
    .on('user_profile')
    .column('avatar_url')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('user_profile').execute()
}
```

### Migrador Programático

```typescript
import { Migrator, FileMigrationProvider } from 'kysely'
import { promises as fs } from 'fs'
import * as path from 'path'
// Solo ESM — CJS puede usar __dirname directamente
import { fileURLToPath } from 'url'
const migrationFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  './migrations',
)

// `db` es tu instancia de base de datos Kysely<any>
const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder,
  }),
  // ADVERTENCIA: Solo habilitar en desarrollo. Deshabilita la validación de
  // ordenamiento por timestamp, lo que puede causar deriva de esquema entre entornos.
  // allowUnorderedMigrations: true,
})

const { error, results } = await migrator.migrateToLatest()

results?.forEach((it) => {
  if (it.status === 'Success') {
    console.log(`migration "${it.migrationName}" executed successfully`)
  } else if (it.status === 'Error') {
    console.error(`failed to execute migration "${it.migrationName}"`)
  }
})

if (error) {
  console.error('migration failed', error)
  process.exit(1)
}
```

## Django (Python)

### Flujo de Trabajo

```bash
# Generar migración a partir de cambios de modelo
python manage.py makemigrations

# Aplicar migraciones
python manage.py migrate

# Mostrar estado de migraciones
python manage.py showmigrations

# Generar migración vacía para SQL personalizado
python manage.py makemigrations --empty app_name -n description
```

### Migración de Datos

```python
from django.db import migrations

def backfill_display_names(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    batch_size = 5000
    users = User.objects.filter(display_name="")
    while users.exists():
        batch = list(users[:batch_size])
        for user in batch:
            user.display_name = user.username
        User.objects.bulk_update(batch, ["display_name"], batch_size=batch_size)

def reverse_backfill(apps, schema_editor):
    pass  # Migración de datos, no se necesita reversión

class Migration(migrations.Migration):
    dependencies = [("accounts", "0015_add_display_name")]

    operations = [
        migrations.RunPython(backfill_display_names, reverse_backfill),
    ]
```

### SeparateDatabaseAndState

Eliminar una columna del modelo Django sin eliminarla de la base de datos inmediatamente:

```python
class Migration(migrations.Migration):
    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(model_name="user", name="legacy_field"),
            ],
            database_operations=[],  # No tocar la DB todavía
        ),
    ]
```

## golang-migrate (Go)

### Flujo de Trabajo

```bash
# Crear par de migración
migrate create -ext sql -dir migrations -seq add_user_avatar

# Aplicar todas las migraciones pendientes
migrate -path migrations -database "$DATABASE_URL" up

# Revertir la última migración
migrate -path migrations -database "$DATABASE_URL" down 1

# Forzar versión (corregir estado sucio)
migrate -path migrations -database "$DATABASE_URL" force VERSION
```

### Archivos de Migración

```sql
-- migrations/000003_add_user_avatar.up.sql
ALTER TABLE users ADD COLUMN avatar_url TEXT;
CREATE INDEX CONCURRENTLY idx_users_avatar ON users (avatar_url) WHERE avatar_url IS NOT NULL;

-- migrations/000003_add_user_avatar.down.sql
DROP INDEX IF EXISTS idx_users_avatar;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;
```

## Estrategia de Migración de Zero-Downtime

Para cambios críticos de producción, seguir el patrón expand-contract:

```
Fase 1: EXPAND (Expandir)
  - Agregar nueva columna/tabla (nullable o con valor predeterminado)
  - Desplegar: la app escribe en AMBAS, vieja y nueva
  - Backfill de datos existentes

Fase 2: MIGRATE (Migrar)
  - Desplegar: la app lee de la NUEVA, escribe en AMBAS
  - Verificar consistencia de datos

Fase 3: CONTRACT (Contraer)
  - Desplegar: la app solo usa la NUEVA
  - Eliminar columna/tabla antigua en migración separada
```

### Ejemplo de Línea de Tiempo

```
Día 1: Migración agrega columna new_status (nullable)
Día 1: Desplegar app v2 — escribe en status y new_status
Día 2: Ejecutar migración de backfill para filas existentes
Día 3: Desplegar app v3 — lee solo de new_status
Día 7: Migración elimina columna status antigua
```

## Anti-Patrones

| Anti-Patrón | Por Qué Falla | Mejor Enfoque |
|-------------|-------------|-----------------|
| SQL manual en producción | Sin historial de auditoría, no repetible | Siempre usar archivos de migración |
| Editar migraciones desplegadas | Causa deriva entre entornos | Crear nueva migración en su lugar |
| NOT NULL sin valor predeterminado | Bloquea tabla, reescribe todas las filas | Agregar nullable, backfill, luego agregar restricción |
| Índice en línea en tabla grande | Bloquea escrituras durante la construcción | CREATE INDEX CONCURRENTLY |
| Esquema + datos en una migración | Difícil de revertir, transacciones largas | Migraciones separadas |
| Eliminar columna antes de eliminar código | Errores de aplicación por columna faltante | Eliminar código primero, eliminar columna en el próximo despliegue |
