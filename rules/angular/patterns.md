---
paths:
  - "**/*.component.ts"
  - "**/*.component.html"
  - "**/*.service.ts"
  - "**/*.store.ts"
  - "**/*.routes.ts"
---
# Angular Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Angular specific content.

## Smart / Dumb Component Split

Smart (container) components own data fetching and state. Dumb (presentational) components receive inputs and emit outputs only — no service injection.

```typescript
// Smart — owns data
@Component({ standalone: true, changeDetection: ChangeDetectionStrategy.OnPush })
export class UserPageComponent {
  private userService = inject(UserService);
  user = toSignal(this.userService.getUser(this.userId));
}
```

```html
<!-- Dumb — pure presentation -->
<app-user-card [user]="user()" (select)="onSelect($event)" />
```

## Service Layer

Services own all data access and business logic. Components delegate — no `HttpClient` in components.

```typescript
@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);

  getUsers(): Observable<User[]> {
    return this.http.get<User[]>('/api/users');
  }
}
```

## Async Data with `resource`

Use `resource()` for reactive async fetching. Prefer over manual RxJS pipelines for simple data loading:

```typescript
export class UserDetailComponent {
  userId = input.required<string>();

  userResource = resource({
    request: () => ({ id: this.userId() }),
    loader: ({ request }) =>
      firstValueFrom(inject(UserService).getUser(request.id)),
  });
}
```

Access state: `userResource.value()`, `userResource.isLoading()`, `userResource.error()`, `userResource.reload()`.

## Signal State Patterns

```typescript
// Local mutable state
count = signal(0);

// Derived (never duplicated)
doubled = computed(() => this.count() * 2);

// Writable derived state that resets with source
selectedItem = linkedSignal(() => this.items()[0]);

// Bridge Observable to signal
users = toSignal(this.userService.getUsers(), { initialValue: [] });
```

Never store derived values in separate signals — use `computed`. Never use `effect` to sync signals — use `computed` or `linkedSignal`.

## Subscription Cleanup

Use `takeUntilDestroyed()` for all manual subscriptions. Never use manual `ngOnDestroy` + `Subject` + `takeUntil` on new code.

```typescript
export class UserComponent {
  private destroyRef = inject(DestroyRef);

  ngOnInit() {
    this.userService.updates$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(update => this.handleUpdate(update));
  }
}
```

## Routing

### Route Definition

```typescript
// app.routes.ts
export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'admin',
    canMatch: [authGuard],           // CanMatch prevents loading the chunk at all
    loadChildren: () => import('./admin/admin.routes').then(m => m.ADMIN_ROUTES),
  },
  {
    path: 'users/:id',
    resolve: { user: userResolver },
    component: UserDetailComponent,
  },
];
```

- Use `canMatch` over `canActivate` when the route module should not load for unauthorized users
- Lazy-load all feature modules with `loadChildren`
- Pre-fetch data with `resolve` to avoid loading states in components

### Functional Guards

```typescript
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated()
    ? true
    : inject(Router).createUrlTree(['/login']);
};
```

### Data Resolvers

```typescript
export const userResolver: ResolveFn<User> = (route) => {
  return inject(UserService).getUser(route.paramMap.get('id')!);
};
```

### View Transitions

Enable smooth route transitions with the View Transitions API:

```typescript
// app.config.ts
provideRouter(routes, withViewTransitions())
```

## Dependency Injection Patterns

### Scoped Providers

Provide services at component or route level when they should not be singletons:

```typescript
@Component({
  providers: [UserEditService],   // scoped to this component subtree
})
export class UserEditComponent {}
```

### `InjectionToken`

```typescript
export const CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

// In providers:
{ provide: CONFIG, useValue: appConfig }
{ provide: CONFIG, useFactory: () => loadConfig(), deps: [] }

// Consume:
private config = inject(CONFIG);
```

### `viewProviders` vs `providers`

- `providers`: Available to the component and all its content children
- `viewProviders`: Available only to the component's own view (not projected content)

## HTTP Interceptors

Use functional interceptors (v15+) for auth, error handling, and retries:

```typescript
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
```

Register in `app.config.ts`:

```typescript
provideHttpClient(withInterceptors([authInterceptor, errorInterceptor]))
```

## RxJS Operators

- `switchMap` — search, navigation (cancels previous)
- `mergeMap` — independent parallel requests
- `exhaustMap` — form submissions (ignores until complete)
- Always handle errors with `catchError` — never let streams die silently

```typescript
search$ = this.query$.pipe(
  debounceTime(300),
  distinctUntilChanged(),
  switchMap(q => this.service.search(q).pipe(catchError(() => of([])))),
);
```

## Forms

Match the project's existing form strategy. For new v21+ apps, prefer signal forms.

```typescript
// Reactive Forms — standard for complex forms
export class UserFormComponent {
  private fb = inject(FormBuilder);

  form = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
  });
}
```

## Rendering Strategies

- **CSR** (default): Standard SPA
- **SSR + Hydration**: `ng add @angular/ssr` — improves FCP and SEO
- **SSG (Prerendering)**: Static pages at build time for content-heavy routes

When using SSR, avoid `window`, `document`, `localStorage` directly — use `isPlatformBrowser` or `DOCUMENT` token.

## Accessibility

Use Angular CDK for headless, accessible components (Accordion, Listbox, Combobox, Menu, Tabs, Toolbar, Tree, Grid). Style ARIA attributes rather than managing them manually:

```css
[aria-selected="true"] { background: var(--color-selected); }
```

## Skill Reference

See skill: `angular-developer` for deep guidance on signals, forms, routing, DI, SSR, and accessibility patterns.
