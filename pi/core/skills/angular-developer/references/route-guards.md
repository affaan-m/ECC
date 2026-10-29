# Route Guards

Route guards control whether a user can navigate to or leave a route.

## Types of Guards

- **`CanActivate`**: Can the user access this route? (e.g., Auth check).
- **`CanActivateChild`**: Can the user access children of this route?
- **`CanDeactivate`**: Can the user leave this route? (e.g., Unsaved changes).
- **`CanMatch`**: Should this route even be considered for matching? (e.g., Feature flags). If it returns `false`, the router continues checking other routes.

## Creating a Guard

Guards are typically functional since Angular 15.

```ts
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isLoggedIn()) {
    return true;
  }

  // Redirect to login
  return router.parseUrl('/login');
};
```

## Applying Guards

Add them to the route configuration as an array. They execute in order.

```ts
{
  path: 'admin',
  component: Admin,
  canActivate: [authGuard],
  canActivateChild: [adminChildGuard],
  canDeactivate: [unsavedChangesGuard]
}
```

## Return Values

- `boolean`: `true` to allow, `false` to block.
- `UrlTree` or `RedirectCommand`: Redirect to a different route.
- `Observable` or `Promise`: Resolves to the above types.

## Security Note

**Client-side guards are NOT a substitute for server-side security.** Always verify permissions on the server.
