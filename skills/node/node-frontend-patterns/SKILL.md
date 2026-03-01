---
name: node-frontend-patterns
description: Frontend development patterns for Svelte 5, SvelteKit, Tailwind CSS 4, state management with runes, performance optimization, and UI best practices.
---

# Frontend Development Patterns

Modern frontend patterns for Svelte 5, SvelteKit, and Tailwind CSS 4.

## Svelte 5 Runes

### Component Props with $props

```svelte
<!-- Card.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    variant?: 'default' | 'outlined'
    children: Snippet
    header?: Snippet
  }

  let { variant = 'default', children, header }: Props = $props()
</script>

<div class="card card-{variant}">
  {#if header}
    <div class="card-header">
      {@render header()}
    </div>
  {/if}
  <div class="card-body">
    {@render children()}
  </div>
</div>
```

```svelte
<!-- Usage -->
<Card variant="outlined">
  {#snippet header()}
    <h2>Title</h2>
  {/snippet}
  <p>Content goes here</p>
</Card>
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

### Compound Components with Context

```svelte
<!-- Tabs.svelte -->
<script lang="ts" module>
  export interface TabsContext {
    activeTab: string
    setActiveTab: (tab: string) => void
  }
</script>

<script lang="ts">
  import { setContext } from 'svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    defaultTab: string
    children: Snippet
  }

  let { defaultTab, children }: Props = $props()
  let activeTab = $state(defaultTab)

  setContext<TabsContext>('tabs', {
    get activeTab() { return activeTab },
    setActiveTab: (tab: string) => activeTab = tab
  })
</script>

<div class="tabs">
  {@render children()}
</div>
```

```svelte
<!-- Tab.svelte -->
<script lang="ts">
  import { getContext } from 'svelte'
  import type { TabsContext } from './Tabs.svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    id: string
    children: Snippet
  }

  let { id, children }: Props = $props()
  const ctx = getContext<TabsContext>('tabs')
  let isActive = $derived(ctx.activeTab === id)
</script>

<button
  class:active={isActive}
  onclick={() => ctx.setActiveTab(id)}
>
  {@render children()}
</button>
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

## Tailwind CSS 4 Patterns

### CSS-First Configuration

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

/* Custom utility */
@utility container-narrow {
  max-width: 48rem;
  margin-inline: auto;
  padding-inline: 1rem;
}
```

### Dark Mode with Tailwind 4

```svelte
<!-- ThemeToggle.svelte -->
<script lang="ts">
  let isDark = $state(
    typeof window !== 'undefined' &&
    document.documentElement.classList.contains('dark')
  )

  function toggle() {
    isDark = !isDark
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }
</script>

<button
  onclick={toggle}
  class="rounded-lg bg-surface p-2 dark:bg-surface-dark"
>
  {isDark ? 'Light' : 'Dark'}
</button>
```

### Responsive Layout

```svelte
<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4">
  {#each markets as market (market.id)}
    <div class="rounded-xl bg-surface p-6 shadow-sm transition-shadow hover:shadow-md dark:bg-surface-dark">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {market.name}
      </h3>
      <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
        {market.description}
      </p>
    </div>
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

<input
  type="text"
  bind:value={searchQuery}
  placeholder="Search markets..."
  class="w-full rounded-lg border px-4 py-2 focus:ring-2 focus:ring-brand"
/>
```

## Form Handling Patterns

### Form with Validation

```svelte
<script lang="ts">
  import { enhance } from '$app/forms'

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
  use:enhance={() => {
    if (!validate()) return ({ cancel }) => cancel()
    return async ({ result, update }) => {
      if (result.type === 'success') await update()
    }
  }}
>
  <div>
    <input bind:value={name} name="name" placeholder="Market name"
      class="w-full rounded-lg border px-4 py-2"
      class:border-red-500={errors.name}
    />
    {#if errors.name}
      <span class="text-sm text-red-500">{errors.name}</span>
    {/if}
  </div>

  <button type="submit" class="mt-4 rounded-lg bg-brand px-6 py-2 text-white">
    Create Market
  </button>
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

<!-- Modal -->
{#if isOpen}
  <div transition:fade={{ duration: 200 }} class="fixed inset-0 bg-black/50"
    onclick={close}
  />
  <div
    transition:fly={{ y: 20, duration: 300 }}
    class="fixed inset-x-4 top-1/4 mx-auto max-w-lg rounded-xl bg-white p-6 shadow-xl"
  >
    <slot />
  </div>
{/if}
```

## Accessibility Patterns

### Keyboard Navigation

```svelte
<script lang="ts">
  interface Props {
    options: string[]
    onselect: (option: string) => void
  }

  let { options, onselect }: Props = $props()
  let isOpen = $state(false)
  let activeIndex = $state(0)

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        activeIndex = Math.min(activeIndex + 1, options.length - 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        activeIndex = Math.max(activeIndex - 1, 0)
        break
      case 'Enter':
        e.preventDefault()
        onselect(options[activeIndex])
        isOpen = false
        break
      case 'Escape':
        isOpen = false
        break
    }
  }
</script>

<div
  role="combobox"
  aria-expanded={isOpen}
  aria-haspopup="listbox"
  onkeydown={handleKeydown}
>
  <!-- Dropdown implementation -->
</div>
```

**Remember**: Svelte 5 runes replace stores for local state. Use `$state` for reactive values, `$derived` for computed values, and `$effect` for side effects. Tailwind CSS 4 uses CSS-first configuration with `@theme` and `@import "tailwindcss"`.
