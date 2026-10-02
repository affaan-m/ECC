# Route Loading Strategies

Angular supports two main strategies for loading routes and components to balance initial load time and navigation responsiveness.

## Eager Loading

Components are bundled into the initial JavaScript payload and are available immediately.

```ts
{ path: 'home', component: Home }
```

- **Pros**: Seamless transitions.
- **Cons**: Increases initial bundle size.

## Lazy Loading

Components or routes are loaded only when the user navigates to them. This creates separate JavaScript "chunks".

### Lazy Loading Components

Use `loadComponent` to fetch the component on demand.

```ts
{
  path: 'admin',
  loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent),
}
```

### Lazy Loading Child Routes

Use `loadChildren` to fetch a set of routes.

```ts
{
  path: 'settings',
  loadChildren: () => import('./settings/settings.routes'),
}
```

## Injection Context and Lazy Loading

Loader functions run within the **injection context** of the current route. This allows you to call `inject()` to make context-aware loading decisions.

```ts
{
  path: 'dashboard',
  loadComponent: () => {
    const flags = inject(FeatureFlags);
    return flags.isPremium
      ? import('./premium-dashboard')
      : import('./basic-dashboard');
  },
}
```

## Recommendation

- Use **Eager Loading** for the primary landing pages.
- Use **Lazy Loading** for all other feature areas to keep the initial bundle small.
