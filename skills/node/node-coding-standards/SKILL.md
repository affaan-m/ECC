---
name: node-coding-standards
description: Coding standards, best practices, and patterns for TypeScript, Svelte 5, SvelteKit, and Node.js development.
---

# Coding Standards & Best Practices

Coding standards for Svelte 5, SvelteKit, TypeScript, and Node.js projects.

## Code Quality Principles

### 1. Readability First

- Code is read more than written
- Clear variable and function names
- Self-documenting code preferred over comments
- Consistent formatting

### 2. KISS (Keep It Simple, Stupid)

- Simplest solution that works
- Avoid over-engineering
- No premature optimization
- Easy to understand > clever code

### 3. DRY (Don't Repeat Yourself)

- Extract common logic into functions
- Create reusable components
- Share utilities across modules
- Avoid copy-paste programming

### 4. YAGNI (You Aren't Gonna Need It)

- Don't build features before they're needed
- Avoid speculative generality
- Add complexity only when required
- Start simple, refactor when needed

## TypeScript/JavaScript Standards

### Variable Naming

```typescript
// ✅ GOOD: Descriptive names
const marketSearchQuery = 'election'
const isUserAuthenticated = true
const totalRevenue = 1000

// ❌ BAD: Unclear names
const q = 'election'
const flag = true
const x = 1000
```

### Function Naming

```typescript
// ✅ GOOD: Verb-noun pattern
async function fetchMarketData(marketId: string) { }
function calculateSimilarity(a: number[], b: number[]) { }
function isValidEmail(email: string): boolean { }

// ❌ BAD: Unclear or noun-only
async function market(id: string) { }
function similarity(a, b) { }
function email(e) { }
```

### Immutability Pattern (CRITICAL)

```typescript
// ✅ ALWAYS use spread operator
const updatedUser = {
  ...user,
  name: 'New Name'
}

const updatedArray = [...items, newItem]

// ❌ NEVER mutate directly
user.name = 'New Name'  // BAD
items.push(newItem)     // BAD
```

### Error Handling

```typescript
// ✅ GOOD: Comprehensive error handling
async function fetchData(url: string) {
  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Fetch failed:', error)
    throw new Error('Failed to fetch data')
  }
}

// ❌ BAD: No error handling
async function fetchData(url) {
  const response = await fetch(url)
  return response.json()
}
```

### Async/Await Best Practices

```typescript
// ✅ GOOD: Parallel execution when possible
const [users, markets, stats] = await Promise.all([
  fetchUsers(),
  fetchMarkets(),
  fetchStats()
])

// ❌ BAD: Sequential when unnecessary
const users = await fetchUsers()
const markets = await fetchMarkets()
const stats = await fetchStats()
```

### Type Safety

```typescript
// ✅ GOOD: Proper types
interface Market {
  id: string
  name: string
  status: 'active' | 'resolved' | 'closed'
  created_at: Date
}

function getMarket(id: string): Promise<Market> {
  // Implementation
}

// ❌ BAD: Using 'any'
function getMarket(id: any): Promise<any> {
  // Implementation
}
```

## Svelte 5 Best Practices

### Component Structure

```svelte
<!-- Button.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte'

  // ✅ GOOD: Typed props with $props
  interface Props {
    onclick: () => void
    disabled?: boolean
    variant?: 'primary' | 'secondary'
    children: Snippet
  }

  let { onclick, disabled = false, variant = 'primary', children }: Props = $props()
</script>

<button {onclick} {disabled} class="btn btn-{variant}">
  {@render children()}
</button>
```

### Reactive State with Runes

```svelte
<script lang="ts">
  // ✅ GOOD: $state for reactive values
  let count = $state(0)
  let doubled = $derived(count * 2)

  // ✅ GOOD: $effect with cleanup
  $effect(() => {
    const timer = setInterval(() => count++, 1000)
    return () => clearInterval(timer)
  })

  // ❌ BAD: Mutating $derived (not allowed)
  // doubled = 10
</script>
```

### Shared State (.svelte.ts)

```typescript
// ✅ GOOD: Reactive store using runes
// stores/counter.svelte.ts
export function createCounter(initial = 0) {
  let count = $state(initial)
  let doubled = $derived(count * 2)

  return {
    get count() { return count },
    get doubled() { return doubled },
    increment: () => count++,
    reset: () => count = initial
  }
}

// ❌ BAD: Exporting $state directly (loses reactivity)
// export let count = $state(0)
```

### Conditional Rendering

```svelte
<!-- ✅ GOOD: Clear conditional blocks -->
{#if isLoading}
  <Spinner />
{:else if error}
  <ErrorMessage {error} />
{:else if data}
  <DataDisplay {data} />
{/if}

<!-- ❌ BAD: Deeply nested ternaries in expressions -->
```

## API Design Standards

### REST API Conventions

```text
GET    /api/markets              # List all markets
GET    /api/markets/:id          # Get specific market
POST   /api/markets              # Create new market
PUT    /api/markets/:id          # Update market (full)
PATCH  /api/markets/:id          # Update market (partial)
DELETE /api/markets/:id          # Delete market

# Query parameters for filtering
GET /api/markets?status=active&limit=10&offset=0
```

### Response Format

```typescript
// ✅ GOOD: Consistent response structure
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}

// Success response (SvelteKit)
return json({
  success: true,
  data: markets,
  meta: { total: 100, page: 1, limit: 10 }
})

// Error response (SvelteKit)
return json({
  success: false,
  error: 'Invalid request'
}, { status: 400 })
```

### Input Validation

```typescript
import { z } from 'zod'

// ✅ GOOD: Schema validation
const CreateMarketSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  endDate: z.string().datetime(),
  categories: z.array(z.string()).min(1)
})

// +server.ts (SvelteKit API route)
export async function POST({ request }: RequestEvent) {
  const body = await request.json()

  try {
    const validated = CreateMarketSchema.parse(body)
    // Proceed with validated data
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({
        success: false,
        error: 'Validation failed',
        details: error.errors
      }, { status: 400 })
    }
  }
}
```

## File Organization

### Project Structure

```text
src/
├── routes/                # SvelteKit file-based routing
│   ├── api/              # API routes (+server.ts)
│   ├── markets/          # Market pages (+page.svelte)
│   └── (auth)/           # Route groups
├── lib/
│   ├── components/       # Svelte components
│   │   ├── ui/          # shadcn-svelte components
│   │   ├── forms/       # Form components
│   │   └── layouts/     # Layout components
│   ├── stores/          # Shared state (.svelte.ts)
│   ├── utils/           # Helper functions
│   └── types/           # TypeScript types
└── app.css              # Tailwind CSS 4 + shadcn theme
```

### File Naming

```text
lib/components/Button.svelte    # PascalCase for components
lib/stores/auth.svelte.ts       # camelCase with .svelte.ts for rune stores
lib/utils/format-date.ts        # kebab-case for utilities
lib/types/market.ts             # kebab-case for type files
```

## Comments & Documentation

### When to Comment

```typescript
// ✅ GOOD: Explain WHY, not WHAT
// Use exponential backoff to avoid overwhelming the API during outages
const delay = Math.min(1000 * Math.pow(2, retryCount), 30000)

// Deliberately using mutation here for performance with large arrays
items.push(newItem)

// ❌ BAD: Stating the obvious
// Increment counter by 1
count++

// Set name to user's name
name = user.name
```

### JSDoc for Public APIs

```typescript
/**
 * Searches markets using semantic similarity.
 *
 * @param query - Natural language search query
 * @param limit - Maximum number of results (default: 10)
 * @returns Array of markets sorted by similarity score
 * @throws {Error} If OpenAI API fails or Redis unavailable
 *
 * @example
 * ```typescript
 * const results = await searchMarkets('election', 5)
 * console.log(results[0].name) // "Trump vs Biden"
 * ```
 */
export async function searchMarkets(
  query: string,
  limit: number = 10
): Promise<Market[]> {
  // Implementation
}
```

## Performance Best Practices

### Derived Values (Svelte 5)

```svelte
<script lang="ts">
  let markets = $state<Market[]>([])

  // ✅ GOOD: $derived for computed values (auto-memoized)
  let sortedMarkets = $derived(
    [...markets].sort((a, b) => b.volume - a.volume)
  )

  // ✅ GOOD: $derived.by for complex derivations
  let stats = $derived.by(() => {
    const active = markets.filter(m => m.status === 'active')
    return { total: markets.length, active: active.length }
  })
</script>
```

### Lazy Loading

```svelte
<script lang="ts">
  import { onMount } from 'svelte'

  let HeavyChart: any = $state(null)

  onMount(async () => {
    const mod = await import('./HeavyChart.svelte')
    HeavyChart = mod.default
  })
</script>

{#if HeavyChart}
  <svelte:component this={HeavyChart} />
{:else}
  <Spinner />
{/if}
```

### Database Queries

```typescript
// ✅ GOOD: Select only needed columns
const { data } = await supabase
  .from('markets')
  .select('id, name, status')
  .limit(10)

// ❌ BAD: Select everything
const { data } = await supabase
  .from('markets')
  .select('*')
```

## Testing Standards

### Test Structure (AAA Pattern)

```typescript
test('calculates similarity correctly', () => {
  // Arrange
  const vector1 = [1, 0, 0]
  const vector2 = [0, 1, 0]

  // Act
  const similarity = calculateCosineSimilarity(vector1, vector2)

  // Assert
  expect(similarity).toBe(0)
})
```

### Test Naming

```typescript
// ✅ GOOD: Descriptive test names
test('returns empty array when no markets match query', () => { })
test('throws error when OpenAI API key is missing', () => { })
test('falls back to substring search when Redis unavailable', () => { })

// ❌ BAD: Vague test names
test('works', () => { })
test('test search', () => { })
```

## Code Smell Detection

Watch for these anti-patterns:

### 1. Long Functions

```typescript
// ❌ BAD: Function > 50 lines
function processMarketData() {
  // 100 lines of code
}

// ✅ GOOD: Split into smaller functions
function processMarketData() {
  const validated = validateData()
  const transformed = transformData(validated)
  return saveData(transformed)
}
```

### 2. Deep Nesting

```typescript
// ❌ BAD: 5+ levels of nesting
if (user) {
  if (user.isAdmin) {
    if (market) {
      if (market.isActive) {
        if (hasPermission) {
          // Do something
        }
      }
    }
  }
}

// ✅ GOOD: Early returns
if (!user) return
if (!user.isAdmin) return
if (!market) return
if (!market.isActive) return
if (!hasPermission) return

// Do something
```

### 3. Magic Numbers

```typescript
// ❌ BAD: Unexplained numbers
if (retryCount > 3) { }
setTimeout(callback, 500)

// ✅ GOOD: Named constants
const MAX_RETRIES = 3
const DEBOUNCE_DELAY_MS = 500

if (retryCount > MAX_RETRIES) { }
setTimeout(callback, DEBOUNCE_DELAY_MS)
```

**Remember**: Code quality is not negotiable. Clear, maintainable code enables rapid development and confident refactoring.
