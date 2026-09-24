---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# Estilo de Código en TypeScript/JavaScript

> Este archivo extiende [common/coding-style.md](../common/coding-style.md) con contenido específico de TypeScript/JavaScript.

## Tipos e Interfaces

Usar tipos para hacer las APIs públicas, modelos compartidos y props de componentes explícitos, legibles y reutilizables.

### APIs Públicas

- Agregar tipos de parámetros y retorno a funciones exportadas, utilidades compartidas y métodos públicos de clases
- Dejar que TypeScript infiera tipos obvios de variables locales
- Extraer formas de objetos inline repetidas en tipos o interfaces nombradas

```typescript
// INCORRECTO: Función exportada sin tipos explícitos
export function formatUser(user) {
  return `${user.firstName} ${user.lastName}`
}

// CORRECTO: Tipos explícitos en APIs públicas
interface User {
  firstName: string
  lastName: string
}

export function formatUser(user: User): string {
  return `${user.firstName} ${user.lastName}`
}
```

### Interfaces vs. Type Aliases

- Usar `interface` para formas de objetos que puedan ser extendidas o implementadas
- Usar `type` para uniones, intersecciones, tuplas, tipos mapeados y tipos utilitarios
- Preferir uniones de literales de string sobre `enum` a menos que se requiera un `enum` para interoperabilidad

```typescript
interface User {
  id: string
  email: string
}

type UserRole = 'admin' | 'member'
type UserWithRole = User & {
  role: UserRole
}
```

### Evitar `any`

- Evitar `any` en el código de aplicación
- Usar `unknown` para entrada externa o no confiable, luego estrecharlo de forma segura
- Usar genéricos cuando el tipo de un valor depende del llamador

```typescript
// INCORRECTO: any elimina la seguridad de tipos
function getErrorMessage(error: any) {
  return error.message
}

// CORRECTO: unknown fuerza estrechamiento seguro
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error'
}
```

### Props de React

- Definir las props de componentes con una `interface` o `type` nombrado
- Tipar las props de callback explícitamente
- No usar `React.FC` a menos que haya una razón específica para hacerlo

```typescript
interface User {
  id: string
  email: string
}

interface UserCardProps {
  user: User
  onSelect: (id: string) => void
}

function UserCard({ user, onSelect }: UserCardProps) {
  return <button onClick={() => onSelect(user.id)}>{user.email}</button>
}
```

### Archivos JavaScript

- En archivos `.js` y `.jsx`, usar JSDoc cuando los tipos mejoran la claridad y una migración a TypeScript no es práctica
- Mantener JSDoc alineado con el comportamiento en tiempo de ejecución

```javascript
/**
 * @param {{ firstName: string, lastName: string }} user
 * @returns {string}
 */
export function formatUser(user) {
  return `${user.firstName} ${user.lastName}`
}
```

## Inmutabilidad

Usar el operador spread para actualizaciones inmutables:

```typescript
interface User {
  id: string
  name: string
}

// INCORRECTO: Mutación
function updateUser(user: User, name: string): User {
  user.name = name // ¡MUTACIÓN!
  return user
}

// CORRECTO: Inmutabilidad
function updateUser(user: Readonly<User>, name: string): User {
  return {
    ...user,
    name
  }
}
```

## Manejo de Errores

Usar async/await con try-catch y estrechar errores unknown de forma segura:

```typescript
interface User {
  id: string
  email: string
}

declare function riskyOperation(userId: string): Promise<User>

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error'
}

const logger = {
  error: (message: string, error: unknown) => {
    // Reemplazar con tu logger de producción (por ejemplo, pino o winston).
  }
}

async function loadUser(userId: string): Promise<User> {
  try {
    const result = await riskyOperation(userId)
    return result
  } catch (error: unknown) {
    logger.error('Operation failed', error)
    throw new Error(getErrorMessage(error))
  }
}
```

## Validación de Entrada

Usar Zod para validación basada en esquemas e inferir tipos desde el esquema:

```typescript
import { z } from 'zod'

const userSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150)
})

type UserInput = z.infer<typeof userSchema>

const validated: UserInput = userSchema.parse(input)
```

## Console.log

- Sin sentencias `console.log` en código de producción
- Usar librerías de logging apropiadas en su lugar
- Ver hooks para detección automática
