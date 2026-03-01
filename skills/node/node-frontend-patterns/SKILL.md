---
name: node-frontend-patterns
description: Frontend development patterns for Svelte 5, SvelteKit, Tailwind CSS 4 with shadcn-svelte, state management with runes, performance optimization, and UI best practices.
---

# Frontend Development Patterns

Modern frontend patterns for Svelte 5, SvelteKit, Tailwind CSS 4 with shadcn-svelte.

## Svelte 5 Runes

### Component Props with $props

```svelte
<!-- StatusBadge.svelte -->
<script lang="ts">
  import { Badge } from '$lib/components/ui/badge'

  interface Props {
    status: 'active' | 'resolved' | 'pending'
  }

  let { status }: Props = $props()

  const variantMap = {
    active: 'default',
    resolved: 'secondary',
    pending: 'outline',
  } as const
</script>

<Badge variant={variantMap[status]}>{status}</Badge>
```

```svelte
<!-- Usage with shadcn Card -->
<script lang="ts">
  import * as Card from '$lib/components/ui/card'
  import StatusBadge from './StatusBadge.svelte'
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Market Name</Card.Title>
    <StatusBadge status="active" />
  </Card.Header>
  <Card.Content>
    <p>Content goes here</p>
  </Card.Content>
</Card.Root>
```

### Reactive State with $state and $derived

```svelte
<script lang="ts">
  let count = $state(0)
  let doubled = $derived(count * 2)

  // Deep reactivity with objects
  let user = $state({
    name: 'John',
    preferences: { theme: 'dark' }
  })

  // $state.frozen for immutable data (no deep reactivity)
  let markets = $state.frozen<Market[]>([])
</script>

<p>{count} × 2 = {doubled}</p>
<button onclick={() => count++}>Increment</button>
```

### Side Effects with $effect

```svelte
<script lang="ts">
  let searchQuery = $state('')
  let results = $state<Market[]>([])

  // Runs when searchQuery changes
  $effect(() => {
    if (!searchQuery) return

    const controller = new AbortController()

    fetch(`/api/search?q=${searchQuery}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => results = data)

    // Cleanup function
    return () => controller.abort()
  })

  // Debug with $inspect
  $inspect(results)
</script>
```

### Bindable Props with $bindable

```svelte
<!-- SearchInput.svelte -->
<script lang="ts">
  interface Props {
    value: string
    placeholder?: string
  }

  let { value = $bindable(), placeholder = 'Search...' }: Props = $props()
</script>

<input
  type="text"
  bind:value
  {placeholder}
  class="w-full rounded-lg border px-4 py-2"
/>
```

```svelte
<!-- Usage: two-way binding -->
<script lang="ts">
  let query = $state('')
</script>

<SearchInput bind:value={query} />
<p>Searching: {query}</p>
```

## Component Patterns

### Compound Components with shadcn

Use shadcn components instead of building from scratch:

```svelte
<script lang="ts">
  import * as Tabs from '$lib/components/ui/tabs'
  import * as Card from '$lib/components/ui/card'
</script>

<Tabs.Root value="overview">
  <Tabs.List>
    <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
    <Tabs.Trigger value="analytics">Analytics</Tabs.Trigger>
    <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="overview">
    <Card.Root>
      <Card.Header>
        <Card.Title>Overview</Card.Title>
      </Card.Header>
      <Card.Content>Overview content here</Card.Content>
    </Card.Root>
  </Tabs.Content>
  <Tabs.Content value="analytics">Analytics content</Tabs.Content>
  <Tabs.Content value="settings">Settings content</Tabs.Content>
</Tabs.Root>
```

### Generic Data Loader

```svelte
<!-- DataLoader.svelte -->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'

  interface Props {
    url: string
    children: Snippet<[T]>
    loading?: Snippet
    error?: Snippet<[Error]>
  }

  let { url, children, loading, error: errorSnippet }: Props = $props()

  let data = $state<T | null>(null)
  let isLoading = $state(true)
  let err = $state<Error | null>(null)

  $effect(() => {
    isLoading = true
    err = null

    fetch(url)
      .then(r => r.json())
      .then(d => data = d)
      .catch(e => err = e)
      .finally(() => isLoading = false)
  })
</script>

{#if isLoading && loading}
  {@render loading()}
{:else if err && errorSnippet}
  {@render errorSnippet(err)}
{:else if data}
  {@render children(data)}
{/if}
```

```svelte
<!-- Usage -->
<DataLoader url="/api/markets" let:data>
  {#snippet loading()}
    <Spinner />
  {/snippet}
  {#snippet error(err)}
    <p>Error: {err.message}</p>
  {/snippet}
  <MarketList markets={data} />
</DataLoader>
```

## shadcn-svelte + Tailwind CSS 4

### Setup

```bash
# Initialize shadcn-svelte in your project
bunx shadcn-svelte@latest init

# Add components as needed
bunx shadcn-svelte@latest add button card dialog input select tabs table badge
```

shadcn-svelte generates components into `$lib/components/ui/` that you own and can customize. Built on Bits UI (headless) + Tailwind CSS.

### Using shadcn Components

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Create Market</Card.Title>
    <Card.Description>Fill in the details below.</Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <div class="space-y-2">
      <Label for="name">Name</Label>
      <Input id="name" placeholder="Market name" />
    </div>
    <Button>Submit</Button>
  </Card.Content>
</Card.Root>
```

### Component Variants with tailwind-variants

```typescript
// $lib/components/ui/badge/index.ts
import { tv, type VariantProps } from 'tailwind-variants'

export const badgeVariants = tv({
  base: 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground',
      secondary: 'bg-secondary text-secondary-foreground',
      destructive: 'bg-destructive text-destructive-foreground',
      outline: 'border text-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export type BadgeVariant = VariantProps<typeof badgeVariants>
```

### Dialog / Modal Pattern

```svelte
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'

  let open = $state(false)
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger asChild let:builder>
    <Button builders={[builder]}>Open Dialog</Button>
  </Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Confirm Action</Dialog.Title>
      <Dialog.Description>This cannot be undone.</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => open = false}>Cancel</Button>
      <Button variant="destructive" onclick={handleConfirm}>Confirm</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
```

### Data Table with shadcn

```svelte
<script lang="ts">
  import * as Table from '$lib/components/ui/table'

  interface Props {
    markets: Market[]
  }

  let { markets }: Props = $props()
</script>

<Table.Root>
  <Table.Header>
    <Table.Row>
      <Table.Head>Name</Table.Head>
      <Table.Head>Status</Table.Head>
      <Table.Head class="text-right">Volume</Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each markets as market (market.id)}
      <Table.Row>
        <Table.Cell class="font-medium">{market.name}</Table.Cell>
        <Table.Cell>{market.status}</Table.Cell>
        <Table.Cell class="text-right">{market.volume}</Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>
```

### Tailwind CSS 4 Theme Configuration

```css
/* app.css */
@import "tailwindcss";

@theme {
  --color-brand: #3b82f6;
  --color-brand-dark: #1d4ed8;
  --color-surface: #ffffff;
  --color-surface-dark: #1e293b;

  --font-sans: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --breakpoint-3xl: 1920px;

  --animate-fade-in: fade-in 0.3s ease-out;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Custom variant */
@variant dark (&:where(.dark, .dark *));
```

### Dark Mode Toggle

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { toggleMode } from 'mode-watcher'
</script>

<Button variant="outline" size="icon" onclick={toggleMode}>
  <span class="dark:hidden">Dark</span>
  <span class="hidden dark:inline">Light</span>
</Button>
```

### Responsive Layout with shadcn Cards

```svelte
<script lang="ts">
  import * as Card from '$lib/components/ui/card'
</script>

<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4">
  {#each markets as market (market.id)}
    <Card.Root class="transition-shadow hover:shadow-md">
      <Card.Header>
        <Card.Title>{market.name}</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="text-sm text-muted-foreground">{market.description}</p>
      </Card.Content>
    </Card.Root>
  {/each}
</div>
```

## State Management Patterns

### Shared State with Stores (Svelte 5)

```typescript
// stores/markets.svelte.ts
export function createMarketStore() {
  let markets = $state<Market[]>([])
  let selectedMarket = $state<Market | null>(null)
  let loading = $state(false)

  async function fetchMarkets() {
    loading = true
    try {
      const res = await fetch('/api/markets')
      markets = await res.json()
    } finally {
      loading = false
    }
  }

  function selectMarket(market: Market) {
    selectedMarket = market
  }

  return {
    get markets() { return markets },
    get selectedMarket() { return selectedMarket },
    get loading() { return loading },
    fetchMarkets,
    selectMarket
  }
}

export const marketStore = createMarketStore()
```

```svelte
<!-- Usage -->
<script lang="ts">
  import { marketStore } from '$lib/stores/markets.svelte'
  import { onMount } from 'svelte'

  onMount(() => {
    marketStore.fetchMarkets()
  })
</script>

{#if marketStore.loading}
  <Spinner />
{:else}
  {#each marketStore.markets as market (market.id)}
    <button onclick={() => marketStore.selectMarket(market)}>
      {market.name}
    </button>
  {/each}
{/if}
```

### URL State with SvelteKit

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { page } from '$app/stores'
  import { goto } from '$app/navigation'

  let { data } = $props()

  let query = $derived($page.url.searchParams.get('q') ?? '')
  let sort = $derived($page.url.searchParams.get('sort') ?? 'newest')

  function updateSearch(q: string) {
    const url = new URL($page.url)
    url.searchParams.set('q', q)
    goto(url, { replaceState: true, noScroll: true })
  }
</script>
```

## Performance Optimization

### Virtualization for Long Lists

```svelte
<script lang="ts">
  import { VirtualList } from '@sveltejs/svelte-virtual-list'

  interface Props {
    markets: Market[]
  }

  let { markets }: Props = $props()
</script>

<VirtualList items={markets} height={600} itemHeight={100} let:item>
  <div class="border-b p-4">
    <h3>{item.name}</h3>
    <p>{item.description}</p>
  </div>
</VirtualList>
```

### Lazy Loading Components

```svelte
<script lang="ts">
  import { onMount } from 'svelte'

  let HeavyChart: typeof import('./HeavyChart.svelte').default | null = $state(null)
  let visible = $state(false)

  onMount(async () => {
    if (visible) {
      const mod = await import('./HeavyChart.svelte')
      HeavyChart = mod.default
    }
  })
</script>

<div bind:this={container} use:inview on:inview={() => visible = true}>
  {#if HeavyChart}
    <HeavyChart {data} />
  {:else}
    <div class="h-64 animate-pulse rounded-lg bg-gray-200" />
  {/if}
</div>
```

### Debounced Search

```svelte
<script lang="ts">
  import { Input } from '$lib/components/ui/input'

  let searchQuery = $state('')
  let debouncedQuery = $state('')
  let timer: ReturnType<typeof setTimeout>

  $effect(() => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      debouncedQuery = searchQuery
    }, 300)
    return () => clearTimeout(timer)
  })

  $effect(() => {
    if (debouncedQuery) {
      performSearch(debouncedQuery)
    }
  })
</script>

<Input
  type="text"
  bind:value={searchQuery}
  placeholder="Search markets..."
/>
```

## Form Handling Patterns

### Form with shadcn + Validation

```svelte
<script lang="ts">
  import { enhance } from '$app/forms'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Textarea } from '$lib/components/ui/textarea'

  let name = $state('')
  let description = $state('')
  let endDate = $state('')

  let errors = $state<Record<string, string>>({})

  function validate(): boolean {
    errors = {}
    if (!name.trim()) errors.name = 'Name is required'
    else if (name.length > 200) errors.name = 'Name must be under 200 characters'
    if (!description.trim()) errors.description = 'Description is required'
    if (!endDate) errors.endDate = 'End date is required'
    return Object.keys(errors).length === 0
  }
</script>

<form
  method="POST"
  action="?/create"
  class="space-y-4"
  use:enhance={() => {
    if (!validate()) return ({ cancel }) => cancel()
    return async ({ result, update }) => {
      if (result.type === 'success') await update()
    }
  }}
>
  <div class="space-y-2">
    <Label for="name">Market Name</Label>
    <Input id="name" bind:value={name} placeholder="Market name"
      class={errors.name ? 'border-destructive' : ''}
    />
    {#if errors.name}
      <p class="text-sm text-destructive">{errors.name}</p>
    {/if}
  </div>

  <div class="space-y-2">
    <Label for="description">Description</Label>
    <Textarea id="description" bind:value={description} placeholder="Describe the market" />
    {#if errors.description}
      <p class="text-sm text-destructive">{errors.description}</p>
    {/if}
  </div>

  <Button type="submit">Create Market</Button>
</form>
```

### SvelteKit Form Actions

```typescript
// +page.server.ts
import { fail } from '@sveltejs/kit'
import type { Actions } from './$types'

export const actions = {
  create: async ({ request }) => {
    const data = await request.formData()
    const name = data.get('name') as string

    if (!name?.trim()) {
      return fail(400, { name, error: 'Name is required' })
    }

    await db.market.create({ data: { name } })
    return { success: true }
  }
} satisfies Actions
```

## Error Handling

### Error Boundary with SvelteKit

```svelte
<!-- +error.svelte -->
<script lang="ts">
  import { page } from '$app/stores'
</script>

<div class="flex min-h-screen items-center justify-center">
  <div class="text-center">
    <h1 class="text-4xl font-bold text-gray-900">{$page.status}</h1>
    <p class="mt-2 text-gray-600">{$page.error?.message}</p>
    <a href="/" class="mt-4 inline-block text-brand hover:underline">
      Go home
    </a>
  </div>
</div>
```

## Animation Patterns

### Svelte Transitions

```svelte
<script lang="ts">
  import { fade, fly, slide } from 'svelte/transition'
  import { flip } from 'svelte/animate'

  let markets = $state<Market[]>([])
</script>

<!-- List with animations -->
{#each markets as market (market.id)}
  <div
    in:fly={{ y: 20, duration: 300 }}
    out:fade={{ duration: 200 }}
    animate:flip={{ duration: 300 }}
    class="rounded-lg border p-4"
  >
    {market.name}
  </div>
{/each}

<!-- For modals, prefer shadcn Dialog over manual transitions -->
<!-- See Dialog pattern in shadcn-svelte section above -->
```

## Accessibility

shadcn-svelte components (built on Bits UI) include keyboard navigation, ARIA attributes, and focus management out of the box. For custom interactive components, use Bits UI primitives:

```svelte
<script lang="ts">
  import * as Select from '$lib/components/ui/select'

  let selected = $state<string>()
</script>

<!-- Select handles keyboard nav, ARIA, focus automatically -->
<Select.Root bind:value={selected}>
  <Select.Trigger>
    <Select.Value placeholder="Choose status" />
  </Select.Trigger>
  <Select.Content>
    <Select.Item value="active">Active</Select.Item>
    <Select.Item value="resolved">Resolved</Select.Item>
    <Select.Item value="pending">Pending</Select.Item>
  </Select.Content>
</Select.Root>
```

**Remember**: Use shadcn-svelte components for consistent, accessible UI. Svelte 5 runes replace stores for local state. Use `$state` for reactive values, `$derived` for computed values, and `$effect` for side effects. Tailwind CSS 4 uses CSS-first configuration with `@theme` and `@import "tailwindcss"`.
