---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/components/**/*.ts"
  - "**/components/**/*.js"
  - "**/app/**/*.tsx"
  - "**/pages/**/*.tsx"
---
# React Patterns

> This file extends [typescript/patterns.md](typescript-patterns.md) and [common/patterns.md](common-patterns.md) with React specific content. For hook-specific rules see [hooks.md](react-hooks.md).

## Container / Presentational Split

Container components own data fetching, state, and side effects. Presentational components receive props and render — no service calls, no hooks beyond local UI state.

```tsx
// Container — owns data
export function UserPage({ userId }: { userId: string }) {
  const { data: user, isLoading } = useUser(userId);
  if (isLoading) return <Spinner />;
  if (!user) return <NotFound />;
  return <UserCard user={user} onSelect={handleSelect} />;
}

// Presentational — pure
export function UserCard({ user, onSelect }: { user: User; onSelect: (id: string) => void }) {
  return <button onClick={() => onSelect(user.id)}>{user.name}</button>;
}
```

## State Location Decision Tree

1. Used by one component → `useState` inside it
2. Used by parent + a few children → lift to nearest common ancestor, pass via props
3. Used across distant branches → React Context **for low-frequency reads only** (theme, auth, locale)
4. High-frequency updates shared across the tree → external store (Zustand, Jotai, Redux Toolkit)
5. Server-derived data → server-state library (TanStack Query, SWR, RSC fetch) — not application state

Context misused for frequently changing values causes every consumer to re-render on every update.

## Server / Client Component Boundary (RSC, Next.js App Router)

- Server Components are the default — they run on the server, do not ship to the client, and can `await` directly
- Client Components opt in with `"use client"` at the top of the file
- Data flows down: a Server Component can render a Client Component and pass serializable props
- A Client Component cannot import a Server Component, but it can receive one via `children` or named slots

```tsx
// Server (default)
export default async function Page() {
  const user = await fetchUser();
  return <UserClient user={user} />;
}

// Client
"use client";
export function UserClient({ user }: { user: User }) {
  const [tab, setTab] = useState("profile");
  return <Tabs value={tab} onChange={setTab}>{user.name}</Tabs>;
}
```

- Never import `"server-only"` packages (DB clients, secrets) from a Client Component file — wrap them in a Server Component or Server Action
- Mark sensitive modules with `import "server-only"` so the bundler errors if a client file imports them

## Suspense + Error Boundaries

Every Suspense boundary needs an Error Boundary above it. The pair handles both states.

```tsx
<ErrorBoundary fallback={<ErrorView />}>
  <Suspense fallback={<Skeleton />}>
    <UserDetails id={id} />
  </Suspense>
</ErrorBoundary>
```

- Place Suspense boundaries close to where data is needed, not at the route root
- Multiple narrower boundaries reveal loaded content progressively
- Error Boundary must be a Class Component (React 19 has no functional equivalent yet) OR use a library wrapper such as `react-error-boundary`

## Forms

### Uncontrolled (React 19 + form actions)

Prefer uncontrolled inputs with form actions when the form has a clear submit step. The browser owns the value; React reads it via `FormData` on submit.

```tsx
async function action(formData: FormData) {
  "use server";
  await saveUser({ name: String(formData.get("name")) });
}

export function UserForm() {
  return (
    <form action={action}>
      <input name="name" required />
      <button type="submit">Save</button>
    </form>
  );
}
```

### Controlled

Use controlled inputs when the value drives other UI, requires real-time validation, or formatting.

```tsx
const [email, setEmail] = useState("");
return <input value={email} onChange={(e) => setEmail(e.target.value)} />;
```

### Form Libraries

For complex forms (multi-step, dynamic field arrays, cross-field validation), use a library:

- React Hook Form — minimal re-renders, uncontrolled-first
- TanStack Form — typed, framework-agnostic
- Final Form — when subscription-based re-renders matter

## Data Fetching

| Strategy | When |
|---|---|
| RSC fetch (`await` in Server Component) | Per-request data in Next.js App Router, no client-side cache needed |
| TanStack Query | Client-side cache, mutations, optimistic updates, polling |
| SWR | Lightweight cache + revalidation, simpler than TanStack Query |
| `fetch` in `useEffect` | Avoid — race conditions, no cache, no retry. Only acceptable for one-off fire-and-forget |

Never fetch in a `useEffect` when a real cache library is available — they handle deduping, cache invalidation, error retry, and Suspense integration.

## Lists and Keys

- `key` must be stable across renders — never `index` for any list that can reorder, insert, or delete
- `key` must be unique among siblings, not globally
- A reordered list with index keys causes state in child components to attach to the wrong row

## Composition over Inheritance

- Pass `children` for slot-style composition
- Pass render-prop functions for parameterized rendering
- Pass component types for plug-in points: `renderItem={UserRow}`
- Never extend a component class to specialize behavior

## Compound Components

For related controls (Tabs, Accordion, Menu), use compound components sharing state via Context:

```tsx
<Tabs defaultValue="profile">
  <Tabs.List>
    <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
    <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="profile"><ProfileForm /></Tabs.Panel>
  <Tabs.Panel value="settings"><SettingsForm /></Tabs.Panel>
</Tabs>
```

## Portals

Use `createPortal` for modals, tooltips, toast containers — anything that must escape the parent's `overflow: hidden` or `z-index` stacking context. Render to a stable DOM node mounted in `index.html`.

## Refs and Forwarding (React 19+)

React 19 lets function components accept `ref` as a regular prop — `forwardRef` is no longer required.

```tsx
export function Input({ ref, ...rest }: { ref?: React.Ref<HTMLInputElement> } & InputProps) {
  return <input ref={ref} {...rest} />;
}
```

Older codebases on React 18 still need `forwardRef`.

## Out of Scope (Pointer Sections)

### Next.js (App Router)

- Server Actions, Route Handlers, Middleware, Parallel/Intercepted Routes, streaming Metadata
- Treated as a separate framework concern — when adding deep Next-specific patterns, propose a dedicated `rules/nextjs/` track
- For now follow Next.js official docs for App Router specifics

### React Native

- Platform-specific imports (`Platform.OS`, `.ios.tsx` / `.android.tsx`), `StyleSheet`, navigation libraries (React Navigation, Expo Router)
- Treated as a separate track — `rules/react-native/` is not yet present
- React core hooks/patterns from this file still apply

## Skill Reference

For React-specific deep dives see `skills/react-patterns/SKILL.md`. For cross-framework frontend concerns see `skills/frontend-patterns/SKILL.md`. For accessibility see `skills/accessibility/SKILL.md`.
