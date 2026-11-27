---
name: security-review
description: Usar este skill al agregar autenticación, manejar entradas de usuario, trabajar con secretos, crear endpoints de API o implementar funcionalidades de pago/sensibles. Proporciona lista de verificación y patrones de seguridad completos.
origin: ECC
---

# Skill de Revisión de Seguridad

Este skill garantiza que todo el código siga las buenas prácticas de seguridad e identifica vulnerabilidades potenciales.

## Cuándo Activar

- Implementar autenticación o autorización
- Manejar entrada de usuario o subida de archivos
- Crear nuevos endpoints de API
- Trabajar con secretos o credenciales
- Implementar funcionalidades de pago
- Almacenar o transmitir datos sensibles
- Integrar APIs de terceros

## Lista de Verificación de Seguridad

### 1. Gestión de Secretos

#### FALLA: NUNCA Hacer Esto
```typescript
const apiKey = "sk-proj-xxxxx"  // Secreto hardcodeado
const dbPassword = "password123" // En el código fuente
```

#### PASA: SIEMPRE Hacer Esto
```typescript
const apiKey = process.env.OPENAI_API_KEY
const dbUrl = process.env.DATABASE_URL

// Verificar que los secretos existen
if (!apiKey) {
  throw new Error('OPENAI_API_KEY not configured')
}
```

#### Pasos de Verificación
- [ ] Sin claves de API, tokens ni contraseñas hardcodeadas
- [ ] Todos los secretos en variables de entorno
- [ ] `.env.local` en .gitignore
- [ ] Sin secretos en el historial de git
- [ ] Secretos de producción en la plataforma de hosting (Vercel, Railway)

### 2. Validación de Entrada

#### Siempre Validar la Entrada del Usuario
```typescript
import { z } from 'zod'

// Definir esquema de validación
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(150)
})

// Validar antes de procesar
export async function createUser(input: unknown) {
  try {
    const validated = CreateUserSchema.parse(input)
    return await db.users.create(validated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error.errors }
    }
    throw error
  }
}
```

#### Validación de Subida de Archivos
```typescript
function validateFileUpload(file: File) {
  // Verificar tamaño (máximo 5MB)
  const maxSize = 5 * 1024 * 1024
  if (file.size > maxSize) {
    throw new Error('File too large (max 5MB)')
  }

  // Verificar tipo
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif']
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Invalid file type')
  }

  // Verificar extensión
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif']
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]
  if (!extension || !allowedExtensions.includes(extension)) {
    throw new Error('Invalid file extension')
  }

  return true
}
```

#### Pasos de Verificación
- [ ] Todas las entradas del usuario validadas con esquemas
- [ ] Subidas de archivos restringidas (tamaño, tipo, extensión)
- [ ] Sin uso directo de entrada del usuario en consultas
- [ ] Validación por lista blanca (no por lista negra)
- [ ] Los mensajes de error no revelan información sensible

### 3. Prevención de Inyección SQL

#### FALLA: NUNCA Concatenar SQL
```typescript
// PELIGROSO - Vulnerabilidad de inyección SQL
const query = `SELECT * FROM users WHERE email = '${userEmail}'`
await db.query(query)
```

#### PASA: SIEMPRE Usar Consultas Parametrizadas
```typescript
// Seguro - consulta parametrizada
const { data } = await supabase
  .from('users')
  .select('*')
  .eq('email', userEmail)

// O con SQL puro
await db.query(
  'SELECT * FROM users WHERE email = $1',
  [userEmail]
)
```

#### Pasos de Verificación
- [ ] Todas las consultas de base de datos usan consultas parametrizadas
- [ ] Sin concatenación de cadenas en SQL
- [ ] ORM/query builder usado correctamente
- [ ] Consultas de Supabase correctamente sanitizadas

### 4. Autenticación y Autorización

#### Manejo de Tokens JWT
```typescript
// FALLA: INCORRECTO: localStorage (vulnerable a XSS)
localStorage.setItem('token', token)

// PASA: CORRECTO: cookies httpOnly
res.setHeader('Set-Cookie',
  `token=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`)
```

#### Verificaciones de Autorización
```typescript
export async function deleteUser(userId: string, requesterId: string) {
  // SIEMPRE verificar la autorización primero
  const requester = await db.users.findUnique({
    where: { id: requesterId }
  })

  if (requester.role !== 'admin') {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    )
  }

  // Proceder con la eliminación
  await db.users.delete({ where: { id: userId } })
}
```

#### Row Level Security (Supabase)
```sql
-- Habilitar RLS en todas las tablas
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Los usuarios solo pueden ver sus propios datos
CREATE POLICY "Users view own data"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Los usuarios solo pueden actualizar sus propios datos
CREATE POLICY "Users update own data"
  ON users FOR UPDATE
  USING (auth.uid() = id);
```

#### Pasos de Verificación
- [ ] Tokens almacenados en cookies httpOnly (no localStorage)
- [ ] Verificaciones de autorización antes de operaciones sensibles
- [ ] Row Level Security habilitado en Supabase
- [ ] Control de acceso basado en roles implementado
- [ ] Gestión de sesiones segura

### 5. Prevención de XSS

#### Sanitizar HTML
```typescript
import DOMPurify from 'isomorphic-dompurify'

// SIEMPRE sanitizar HTML proporcionado por el usuario
function renderUserContent(html: string) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p'],
    ALLOWED_ATTR: []
  })
  return <div dangerouslySetInnerHTML={{ __html: clean }} />
}
```

#### Content Security Policy

Comenzar con una política estricta y relajarla solo con un plan de eliminación documentado.
No usar `'unsafe-inline'` ni `'unsafe-eval'` por defecto; neutralizan gran parte de la
protección de CSP y deben tratarse como deuda de compatibilidad temporal.

```typescript
// next.config.js
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: `
      default-src 'self';
      base-uri 'self';
      object-src 'none';
      frame-ancestors 'none';
      script-src 'self';
      style-src 'self';
      img-src 'self' data: https:;
      font-src 'self';
      connect-src 'self' https://api.example.com;
    `.replace(/\s{2,}/g, ' ').trim()
  }
]
```

#### Pasos de Verificación
- [ ] HTML proporcionado por el usuario sanitizado
- [ ] Cabeceras CSP configuradas
- [ ] Sin renderizado de contenido dinámico no validado
- [ ] Protección XSS incorporada de React utilizada

### 6. Protección CSRF

#### Tokens CSRF
```typescript
import { csrf } from '@/lib/csrf'

export async function POST(request: Request) {
  const token = request.headers.get('X-CSRF-Token')

  if (!csrf.verify(token)) {
    return NextResponse.json(
      { error: 'Invalid CSRF token' },
      { status: 403 }
    )
  }

  // Procesar solicitud
}
```

#### Cookies SameSite
```typescript
res.setHeader('Set-Cookie',
  `session=${sessionId}; HttpOnly; Secure; SameSite=Strict`)
```

#### Pasos de Verificación
- [ ] Tokens CSRF en operaciones que cambian estado
- [ ] SameSite=Strict en todas las cookies
- [ ] Patrón de doble envío de cookie implementado

### 7. Limitación de Velocidad

#### Limitación de Velocidad en API
```typescript
import rateLimit from 'express-rate-limit'

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 solicitudes por ventana
  message: 'Too many requests'
})

// Aplicar a rutas
app.use('/api/', limiter)
```

#### Operaciones Costosas
```typescript
// Limitación agresiva para búsquedas
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // 10 solicitudes por minuto
  message: 'Too many search requests'
})

app.use('/api/search', searchLimiter)
```

#### Pasos de Verificación
- [ ] Limitación de velocidad en todos los endpoints de API
- [ ] Límites más estrictos en operaciones costosas
- [ ] Limitación de velocidad basada en IP
- [ ] Limitación de velocidad basada en usuario (autenticado)

### 8. Exposición de Datos Sensibles

#### Logging
```typescript
// FALLA: INCORRECTO: Registrar datos sensibles
console.log('User login:', { email, password })
console.log('Payment:', { cardNumber, cvv })

// PASA: CORRECTO: Redactar datos sensibles
console.log('User login:', { email, userId })
console.log('Payment:', { last4: card.last4, userId })
```

#### Mensajes de Error
```typescript
// FALLA: INCORRECTO: Exponer detalles internos
catch (error) {
  return NextResponse.json(
    { error: error.message, stack: error.stack },
    { status: 500 }
  )
}

// PASA: CORRECTO: Mensajes de error genéricos
catch (error) {
  console.error('Internal error:', error)
  return NextResponse.json(
    { error: 'An error occurred. Please try again.' },
    { status: 500 }
  )
}
```

#### Pasos de Verificación
- [ ] Sin contraseñas, tokens ni secretos en los logs
- [ ] Mensajes de error genéricos para usuarios
- [ ] Errores detallados solo en logs del servidor
- [ ] Sin stack traces expuestos a los usuarios

### 9. Seguridad en Blockchain (Solana)

#### Verificación de Wallet
```typescript
import { verify } from '@solana/web3.js'

async function verifyWalletOwnership(
  publicKey: string,
  signature: string,
  message: string
) {
  try {
    const isValid = verify(
      Buffer.from(message),
      Buffer.from(signature, 'base64'),
      Buffer.from(publicKey, 'base64')
    )
    return isValid
  } catch (error) {
    return false
  }
}
```

#### Verificación de Transacciones
```typescript
async function verifyTransaction(transaction: Transaction) {
  // Verificar destinatario
  if (transaction.to !== expectedRecipient) {
    throw new Error('Invalid recipient')
  }

  // Verificar monto
  if (transaction.amount > maxAmount) {
    throw new Error('Amount exceeds limit')
  }

  // Verificar que el usuario tiene saldo suficiente
  const balance = await getBalance(transaction.from)
  if (balance < transaction.amount) {
    throw new Error('Insufficient balance')
  }

  return true
}
```

#### Pasos de Verificación
- [ ] Firmas de wallet verificadas
- [ ] Detalles de transacción validados
- [ ] Verificaciones de saldo antes de transacciones
- [ ] Sin firma ciega de transacciones

### 10. Seguridad de Dependencias

#### Actualizaciones Regulares
```bash
# Verificar vulnerabilidades
npm audit

# Corregir problemas reparables automáticamente
npm audit fix

# Actualizar dependencias
npm update

# Verificar paquetes desactualizados
npm outdated
```

#### Archivos Lock
```bash
# SIEMPRE hacer commit de los archivos lock
git add package-lock.json

# Usar en CI/CD para builds reproducibles
npm ci  # En lugar de npm install
```

#### Pasos de Verificación
- [ ] Dependencias actualizadas
- [ ] Sin vulnerabilidades conocidas (npm audit limpio)
- [ ] Archivos lock con commit
- [ ] Dependabot habilitado en GitHub
- [ ] Actualizaciones de seguridad regulares

## Pruebas de Seguridad

### Pruebas de Seguridad Automatizadas
```typescript
// Probar autenticación
test('requires authentication', async () => {
  const response = await fetch('/api/protected')
  expect(response.status).toBe(401)
})

// Probar autorización
test('requires admin role', async () => {
  const response = await fetch('/api/admin', {
    headers: { Authorization: `Bearer ${userToken}` }
  })
  expect(response.status).toBe(403)
})

// Probar validación de entrada
test('rejects invalid input', async () => {
  const response = await fetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ email: 'not-an-email' })
  })
  expect(response.status).toBe(400)
})

// Probar limitación de velocidad
test('enforces rate limits', async () => {
  const requests = Array(101).fill(null).map(() =>
    fetch('/api/endpoint')
  )

  const responses = await Promise.all(requests)
  const tooManyRequests = responses.filter(r => r.status === 429)

  expect(tooManyRequests.length).toBeGreaterThan(0)
})
```

## Lista de Verificación Previa al Despliegue

Antes de CUALQUIER despliegue a producción:

- [ ] **Secretos**: Sin secretos hardcodeados, todos en variables de entorno
- [ ] **Validación de Entrada**: Todas las entradas del usuario validadas
- [ ] **Inyección SQL**: Todas las consultas parametrizadas
- [ ] **XSS**: Contenido del usuario sanitizado
- [ ] **CSRF**: Protección habilitada
- [ ] **Autenticación**: Manejo correcto de tokens
- [ ] **Autorización**: Verificaciones de rol en su lugar
- [ ] **Limitación de Velocidad**: Habilitada en todos los endpoints
- [ ] **HTTPS**: Forzado en producción
- [ ] **Cabeceras de Seguridad**: CSP, X-Frame-Options configurados
- [ ] **Manejo de Errores**: Sin datos sensibles en errores
- [ ] **Logging**: Sin datos sensibles registrados
- [ ] **Dependencias**: Actualizadas, sin vulnerabilidades
- [ ] **Row Level Security**: Habilitado en Supabase
- [ ] **CORS**: Correctamente configurado
- [ ] **Subida de Archivos**: Validada (tamaño, tipo)
- [ ] **Firmas de Wallet**: Verificadas (si hay blockchain)

## Recursos

- OWASP Top 10
- Documentación de seguridad de Next.js
- Documentación de seguridad de Supabase
- Web Security Academy (PortSwigger)

---

**Recuerda**: La seguridad no es opcional. Una sola vulnerabilidad puede comprometer toda la plataforma. Ante la duda, optar por el lado de la precaución.
