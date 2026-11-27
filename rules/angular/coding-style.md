---
paths:
  - "**/*.component.ts"
  - "**/*.component.html"
  - "**/*.service.ts"
  - "**/*.directive.ts"
  - "**/*.pipe.ts"
  - "**/*.guard.ts"
  - "**/*.resolver.ts"
  - "**/*.module.ts"
---
# Angular Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Angular specific content.

## Version Awareness

Always check the project's Angular version before writing code — features differ significantly between versions. Run `ng version` or inspect `package.json`. When creating a new project, do not pin a version unless the user specifies one.

After generating or modifying Angular code, always run `ng build` to catch errors before finishing.

## File Naming

Follow Angular CLI conventions — one artifact per file:

- `user-profile.component.ts` + `user-profile.component.html` + `user-profile.component.spec.ts`
- `user.service.ts`, `auth.guard.ts`, `date-format.pipe.ts`
- Feature folders: `features/users/`, `features/auth/`
- Generate with the CLI: `ng generate component features/users/user-card`

## Components

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

## Dependency Injection

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

## Signals

### Core Primitives

```typescript
count = signal(0);
doubled = computed(() => this.count() * 2);

increment() {
  this.count.update(n => n + 1);
}
```

### `linkedSignal` — Writable Derived State

Use `linkedSignal` when a signal must reset or adapt when a source changes, but also be independently writable:

```typescript
selectedOption = linkedSignal(() => this.options()[0]);
// Resets to first option when options changes, but user can override
```

### `resource` — Async Data into Signals

Use `resource()` to fetch async data reactively without manual subscriptions:

```typescript
userResource = resource({
  request: () => ({ id: this.userId() }),
  loader: ({ request }) => fetch(`/api/users/${request.id}`).then(r => r.json()),
});

// Access: userResource.value(), userResource.isLoading(), userResource.error()
```

### `effect` Usage

Use `effect()` only for side effects that must react to signal changes (logging, third-party DOM manipulation). Never use effects to synchronize signals — use `computed` or `linkedSignal` instead. For DOM work after render, use `afterRenderEffect`.

```typescript
// CORRECT: Side effect
effect(() => console.log('User changed:', this.user()));

// WRONG: Use computed instead
effect(() => { this.fullName.set(`${this.first()} ${this.last()}`); });
```

## Templates

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

## Forms

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

## Component Styles

Use component-level styles with `ViewEncapsulation.Emulated` (default). Avoid `ViewEncapsulation.None` unless building a design system that intentionally bleeds styles.

- Scope styles to the component — do not use global class names inside component stylesheets
- Use `:host` for host element styling
- Prefer CSS custom properties for themeable values

## Change Detection

- Default to `ChangeDetectionStrategy.OnPush` on all new components
- Signals and `async` pipe handle detection automatically — avoid `markForCheck()` and `detectChanges()`
- Never mutate `@Input()` objects in place when using OnPush
