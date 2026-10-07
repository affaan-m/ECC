---
name: rules-angular
description: ECC angular engineering rules for coding style, patterns, security, and testing.
display_name: "ECC Angular Rules"
icon: book
---

# ECC Angular Rules

## Angular Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Angular specific content.

### Version Awareness

Always check the project's Angular version before writing code — features differ significantly between versions. Run `ng version` or inspect `package.json`. When creating a new project, do not pin a version unless the user specifies one.

After generating or modifying Angular code, always run `ng build` to catch errors before finishing.

### File Naming

Follow Angular CLI conventions — one artifact per file:

- `user-profile.component.ts` + `user-profile.component.html` + `user-profile.component.spec.ts`
- `user.service.ts`, `auth.guard.ts`, `date-format.pipe.ts`
- Feature folders: `features/users/`, `features/auth/`
- Generate with the CLI: `ng generate component features/users/user-card`

### Components

Prefer standalone components (v17+ default). Use `OnPush` change detection on all new components.

```typescript
@Component({
  selector: 'app-user-card',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './user-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserCardComponent {
  user = input.required<User>();
  select = output<string>();
}
```

### Dependency Injection

Use `inject()` over constructor injection. Keep constructors empty or remove them entirely.

```typescript
// CORRECT
@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);
  private router = inject(Router);
}

// WRONG: Constructor injection is verbose and harder to tree-shake
constructor(private http: HttpClient, private router: Router) {}
```

Use `InjectionToken` for non-class dependencies:

```typescript
const API_URL = new InjectionToken<string>('API_URL');

// Provide:
{ provide: API_URL, useValue: 'https://api.example.com' }

// Consume:
private apiUrl = inject(API_URL);
```

### Signals

#### Core Primitives

```typescript
count = signal(0);
doubled = computed(() => this.count() * 2);

increment() {
  this.count.update(n => n + 1);
}
```

#### `linkedSignal` — Writable Derived State

Use `linkedSignal` when a signal must reset or adapt when a source changes, but also be independently writable:

```typescript
selectedOption = linkedSignal(() => this.options()[0]);
// Resets to first option when options changes, but user can override
```

#### `resource` — Async Data into Signals

Use `resource()` to fetch async data reactively without manual subscriptions:

```typescript
userResource = resource({
  request: () => ({ id: this.userId() }),
  loader: ({ request }) => fetch(`/api/users/${request.id}`).then(r => r.json()),
});

// Access: userResource.value(), userResource.isLoading(), userResource.error()
```

#### `effect` Usage

Use `effect()` only for side effects that must react to signal changes (logging, third-party DOM manipulation). Never use effects to synchronize signals — use `computed` or `linkedSignal` instead. For DOM work after render, use `afterRenderEffect`.

```typescript
// CORRECT: Side effect
effect(() => console.log('User changed:', this.user()));

// WRONG: Use computed instead
effect(() => { this.fullName.set(`${this.first()} ${this.last()}`); });
```

### Templates

Use v17+ block syntax. Always provide `track` in `@for`:

```html
@for (item of items(); track item.id) {
  <app-item [item]="item" />
}

@if (isLoading()) {
  <app-spinner />
} @else if (error()) {
  <app-error [message]="error()" />
} @else {
  <app-content [data]="data()" />
}
```

No logic in templates beyond simple conditionals — move to component methods or pipes.

### Forms

Choose the form strategy that matches the project's existing approach:

- **Signal Forms** (v21+): Preferred for new projects on v21+. Signal-based form state.
- **Reactive Forms**: `FormBuilder` + `FormGroup` + `FormControl`. Best for complex forms with dynamic validation.
- **Template-Driven Forms**: `ngModel`. Suitable for simple forms only.

```typescript
// Reactive Forms — standard approach for most apps
export class LoginComponent {
  private fb = inject(FormBuilder);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  submit() {
    if (this.form.valid) {
      // use this.form.value
    }
  }
}
```

### Component Styles

Use component-level styles with `ViewEncapsulation.Emulated` (default). Avoid `ViewEncapsulation.None` unless building a design system that intentionally bleeds styles.

- Scope styles to the component — do not use global class names inside component stylesheets
- Use `:host` for host element styling
- Prefer CSS custom properties for themeable values

### Change Detection

- Default to `ChangeDetectionStrategy.OnPush` on all new components
- Signals and `async` pipe handle detection automatically — avoid `markForCheck()` and `detectChanges()`
- Never mutate `@Input()` objects in place when using OnPush

## Angular Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Angular specific content.

### PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **Prettier**: Auto-format `.ts` and `.html` files after edit
- **ESLint / ng lint**: Run `ng lint` after editing Angular source files to catch decorator misuse, template errors, and style violations
- **TypeScript check**: Run `tsc --noEmit` after editing `.ts` files
- **Build check**: Run `ng build` after generating or significantly changing Angular code to catch template and type errors early

### Stop Hooks

- **Lint audit**: Run `ng lint` across modified files before session ends to catch any outstanding violations

## Angular Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Angular specific content.

### Smart / Dumb Component Split

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

### Service Layer

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

### Async Data with `resource`

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

### Signal State Patterns

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

### Subscription Cleanup

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

### Routing

#### Route Definition

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

#### Functional Guards

```typescript
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated()
    ? true
    : inject(Router).createUrlTree(['/login']);
};
```

#### Data Resolvers

```typescript
export const userResolver: ResolveFn<User> = (route) => {
  return inject(UserService).getUser(route.paramMap.get('id')!);
};
```

#### View Transitions

Enable smooth route transitions with the View Transitions API:

```typescript
// app.config.ts
provideRouter(routes, withViewTransitions())
```

### Dependency Injection Patterns

#### Scoped Providers

Provide services at component or route level when they should not be singletons:

```typescript
@Component({
  providers: [UserEditService],   // scoped to this component subtree
})
export class UserEditComponent {}
```

#### `InjectionToken`

```typescript
export const CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

// In providers:
{ provide: CONFIG, useValue: appConfig }
{ provide: CONFIG, useFactory: () => loadConfig(), deps: [] }

// Consume:
private config = inject(CONFIG);
```

#### `viewProviders` vs `providers`

- `providers`: Available to the component and all its content children
- `viewProviders`: Available only to the component's own view (not projected content)

### HTTP Interceptors

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

### RxJS Operators

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

### Forms

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

### Rendering Strategies

- **CSR** (default): Standard SPA
- **SSR + Hydration**: `ng add @angular/ssr` — improves FCP and SEO
- **SSG (Prerendering)**: Static pages at build time for content-heavy routes

When using SSR, avoid `window`, `document`, `localStorage` directly — use `isPlatformBrowser` or `DOCUMENT` token.

### Accessibility

Use Angular CDK for headless, accessible components (Accordion, Listbox, Combobox, Menu, Tabs, Toolbar, Tree, Grid). Style ARIA attributes rather than managing them manually:

```css
[aria-selected="true"] { background: var(--color-selected); }
```

### Skill Reference

See skill: `angular-developer` for deep guidance on signals, forms, routing, DI, SSR, and accessibility patterns.

## Angular Security

> This file extends [common/security.md](../common/security.md) with Angular specific content.

### XSS Prevention

Angular auto-sanitizes bound values. Never bypass the sanitizer on user-controlled input.

```typescript
// WRONG: Bypasses sanitization — XSS risk
this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(userInput);

// CORRECT: Sanitize explicitly before trusting
this.safeHtml = this.sanitizer.sanitize(SecurityContext.HTML, userInput);
```

- Never use `bypassSecurityTrust*` methods without a documented, reviewed reason
- Avoid `[innerHTML]` with untrusted content — use `innerText` or a sanitizing pipe
- Never bind `[href]` to user input — Angular does not block `javascript:` URLs in all contexts
- Never construct template strings from user data

### HTTP Security

Use `HttpClient` exclusively — never raw `fetch()` or `XHR` unless no alternative exists.

```typescript
// WRONG: Bypasses interceptors (auth headers, error handling, logging)
const res = await fetch('/api/users');

// CORRECT
users$ = this.http.get<User[]>('/api/users');
```

- Attach auth tokens via interceptors — never hardcode in individual service calls
- Type and validate API responses — treat external data as `unknown` at the boundary
- Never log HTTP responses that may contain tokens, PII, or credentials

### Secret Management

```typescript
// WRONG: Hardcoded secret in source
const apiKey = 'sk-live-xxxx';

// CORRECT: Injected via environment
import { environment } from '../environments/environment';
const apiKey = environment.apiKey;
```

- Treat `environment.ts` as a config shape — never store real secrets in source-controlled environment files
- Inject production secrets via CI/CD (environment variables, secret managers)

### Route Guards

Every authenticated or role-restricted route must have a guard. Never rely on hiding UI elements alone.

```typescript
{
  path: 'admin',
  canMatch: [authGuard, roleGuard('admin')],
  loadChildren: () => import('./admin/admin.routes'),
}
```

Use `canMatch` for sensitive routes — it prevents the route module from loading at all for unauthorized users.

### SSR Security

When using Angular SSR:

- Never expose server-side environment variables to the client via `TransferState` unless they are intentionally public
- Sanitize all inputs before server-side rendering — DOM-based XSS can occur server-side too
- Avoid `window`, `document`, `localStorage` on the server — gate with `isPlatformBrowser` or inject via `DOCUMENT` token

### Content Security Policy

Configure CSP headers server-side. Avoid `unsafe-inline` in `script-src`. When using SSR with inline scripts, use nonces via Angular's CSP support.

### Agent Support

- Use **security-reviewer** skill for comprehensive security audits

## Angular Testing

> This file extends [common/testing.md](../common/testing.md) with Angular specific content.

### Test Runner

Use the test runner configured by the project. Check `angular.json` and `package.json`; Angular projects commonly use Vitest, Jest, or Jasmine + Karma.

```bash
ng test               # watch mode
ng test --no-watch    # CI mode
```

### TestBed Setup

For standalone components, import the component directly. Call `compileComponents()` for components with external templates.

```typescript
describe('UserCardComponent', () => {
  let fixture: ComponentFixture<UserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UserCardComponent);
  });
});
```

### Signal Inputs

Set signal-based inputs via `fixture.componentRef.setInput()`:

```typescript
fixture.componentRef.setInput('user', mockUser);
fixture.detectChanges();
```

### Component Harnesses

Prefer Angular CDK component harnesses over direct DOM queries for UI interaction. Harnesses are more resilient to markup changes.

```typescript
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatButtonHarness } from '@angular/material/button/testing';

let loader: HarnessLoader;

beforeEach(() => {
  loader = TestbedHarnessEnvironment.loader(fixture);
});

it('triggers save on button click', async () => {
  const button = await loader.getHarness(MatButtonHarness.with({ text: 'Save' }));
  await button.click();
  expect(saveSpy).toHaveBeenCalled();
});
```

### Router Testing

Use `RouterTestingHarness` for components that depend on the router:

```typescript
import { RouterTestingHarness } from '@angular/router/testing';

it('renders user on navigation', async () => {
  const harness = await RouterTestingHarness.create();
  const component = await harness.navigateByUrl('/users/1', UserDetailComponent);
  expect(component.userId()).toBe('1');
});
```

### Async Testing

Use `fakeAsync` + `tick` for controlled async. Use `waitForAsync` for real async with `fixture.whenStable()`.

```typescript
it('loads user after delay', fakeAsync(() => {
  const service = TestBed.inject(UserService);
  vi.spyOn(service, 'getUser').mockReturnValue(of(mockUser));

  fixture.detectChanges();
  tick();
  fixture.detectChanges();

  expect(fixture.nativeElement.querySelector('.name').textContent).toBe(mockUser.name);
}));
```

### HTTP Testing

```typescript
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpTestingController } from '@angular/common/http/testing';

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  httpMock = TestBed.inject(HttpTestingController);
});

afterEach(() => httpMock.verify());
```

### Service Testing

Inject services directly without a component fixture:

```typescript
describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UserService);
  });
});
```

### What to Test

- **Services**: All public methods, error paths, HTTP interactions
- **Components**: Input/output bindings, rendered output for key states, user interactions via harnesses
- **Pipes**: Pure transformation — plain unit tests, no TestBed needed
- **Guards/Resolvers**: Return values for allowed and denied states using `RouterTestingHarness`

### E2E Testing

Use the project's configured E2E framework, such as Cypress or Playwright, for critical user flows.

```typescript
describe('Login flow', () => {
  it('redirects to dashboard on valid credentials', () => {
    cy.visit('/login');
    cy.get('[data-cy=email]').type('user@example.com');
    cy.get('[data-cy=password]').type('password123');
    cy.get('[data-cy=submit]').click();
    cy.url().should('include', '/dashboard');
  });
});
```

- Add `data-cy` attributes to interactive elements for stable selectors
- Do not rely on CSS classes or text content for selectors in E2E tests

### Coverage

Target ≥80% for services and pipes. Components: test behaviour, not implementation details.

### Skill Reference

See skill: `angular-developer` for comprehensive testing patterns, harness usage, and async best practices.
