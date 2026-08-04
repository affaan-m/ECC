# Injection Context

The `inject()` function can only be used when code is executing within an **injection context**.

## Where is an Injection Context Available?

An injection context is automatically available in:

1. **Field initializers** of classes instantiated by DI (`@Injectable`, `@Component`, `@Directive`, `@Pipe`).
2. **Constructors** of classes instantiated by DI.
3. **Factory functions** specified in `useFactory` or `InjectionToken` configurations.
4. **Functional APIs** executed by Angular (e.g., functional route guards, resolvers, interceptors).

```ts
@Component({...})
export class Example {
  // Valid: Field initializer
  private router = inject(Router);

  constructor() {
    // Valid: Constructor
    const http = inject(HttpClient);
  }

  onClick() {
    // Invalid: Not an injection context
    // const auth = inject(AuthService);
  }
}
```

## `runInInjectionContext`

If you need to run a function within an injection context (often needed for dynamic component creation or testing), use `runInInjectionContext`. This requires access to an existing injector (like `EnvironmentInjector` or `Injector`).

```ts
import {Injectable, inject, EnvironmentInjector, runInInjectionContext} from '@angular/core';

@Injectable({providedIn: 'root'})
export class MyService {
  private injector = inject(EnvironmentInjector);

  doSomethingDynamic() {
    runInInjectionContext(this.injector, () => {
      // Now valid to use inject() here
      const router = inject(Router);
    });
  }
}
```

## `assertInInjectionContext`

Use `assertInInjectionContext` in utility functions to guarantee they are called from a valid context. It throws a clear error if not.

```ts
import {assertInInjectionContext, inject, ElementRef} from '@angular/core';

export function injectNativeElement<T extends Element>(): T {
  assertInInjectionContext(injectNativeElement);
  return inject(ElementRef).nativeElement;
}
```
