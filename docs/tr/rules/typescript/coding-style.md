---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript Kodlama Stili

> Bu dosya [common/coding-style.md](../common/coding-style.md) dosyasını TypeScript/JavaScript'e özgü içerikle genişletir.

## Tipler ve Interface'ler

Public API'ları, paylaşılan modelleri ve component prop'larını açık, okunabilir ve yeniden kullanılabilir yapmak için tipleri kullan.

### Public API'lar

- Dışa aktarılan fonksiyonlara, paylaşılan utility'lere ve public sınıf metotlarına parametre ve dönüş tipleri ekle
- TypeScript'in açık local değişken tiplerini çıkarmasına izin ver
- Tekrarlanan inline object şekillerini adlandırılmış tipler veya interface'lere çıkar

```typescript
// YANLIŞ: Açık tipler olmadan dışa aktarılan fonksiyon
export function formatUser(user) {
  return `${user.firstName} ${user.lastName}`
}

// DOĞRU: Public API'larda açık tipler
interface User {
  firstName: string
  lastName: string
}

export function formatUser(user: User): string {
  return `${user.firstName} ${user.lastName}`
}
```

### Interface vs. Type Alias'ları

- Extend edilebilir veya implement edilebilir object şekilleri için `interface` kullan
- Union'lar, intersection'lar, tuple'lar, mapped tipler ve utility tipler için `type` kullan
- Interoperability için `enum` gerekli olmadıkça string literal union'ları tercih et

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

### `any`'den Kaçın

- Uygulama kodunda `any`'den kaçın
- Harici veya güvenilmeyen girdi için `unknown` kullan, ardından güvenli bir şekilde daralt
- Bir değerin tipi çağırana bağlı olduğunda generic'ler kullan

```typescript
// YANLIŞ: any tip güvenliğini kaldırır
function getErrorMessage(error: any) {
  return error.message
}

// DOĞRU: unknown güvenli daraltmayı zorlar
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error'
}
```

### React Props

- Component prop'larını adlandırılmış `interface` veya `type` ile tanımla
- Callback prop'larını açıkça tiplendir
- Belirli bir nedeni olmadıkça `React.FC` kullanma

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

### JavaScript Dosyaları

- `.js` ve `.jsx` dosyalarında, tipler netliği artırdığında ve TypeScript migration pratik olmadığında JSDoc kullan
- JSDoc'u runtime davranışıyla hizalı tut

```javascript
/**
 * @param {{ firstName: string, lastName: string }} user
 * @returns {string}
 */
export function formatUser(user) {
  return `${user.firstName} ${user.lastName}`
}
```

## Immutability

Immutable güncellemeler için spread operator kullan:

```typescript
interface User {
  id: string
  name: string
}

// YANLIŞ: Mutation
function updateUser(user: User, name: string): User {
  user.name = name // MUTASYON!
  return user
}

// DOĞRU: Immutability
function updateUser(user: Readonly<User>, name: string): User {
  return {
    ...user,
    name
  }
}
```

## Hata Yönetimi

Try-catch ile async/await kullan ve unknown hataları güvenli bir şekilde daralt:

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
    // Production logger'ınızla değiştirin (örneğin, pino veya winston).
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

## Input Validasyonu

Schema tabanlı validasyon için Zod kullan ve schema'dan tipleri çıkar:

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

- Production kodunda `console.log` ifadeleri yok
- Bunun yerine uygun logging kütüphaneleri kullan
- Otomatik tespit için hook'lara bakın
