# Router Lifecycle and Events

Angular Router emits events through the `Router.events` observable, allowing you to track the navigation lifecycle from start to finish.

## Common Router Events (Chronological)

1. **`NavigationStart`**: Navigation begins.
2. **`RoutesRecognized`**: Router matches the URL to a route.
3. **`GuardsCheckStart` / `End`**: Evaluation of `canActivate`, `canMatch`, etc.
4. **`ResolveStart` / `End`**: Data resolution phase (fetching data via resolvers).
5. **`NavigationEnd`**: Navigation completed successfully.
6. **`NavigationCancel`**: Navigation canceled (e.g., guard returned `false`).
7. **`NavigationError`**: Navigation failed (e.g., error in resolver).

## Subscribing to Events

Inject the `Router` and filter the `events` observable.

```ts
import {Router, NavigationStart, NavigationEnd} from '@angular/router';

export class MyService {
  private router = inject(Router);

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((event) => {
      console.log('Navigated to:', event.url);
    });
  }
}
```

## Debugging

Enable detailed console logging of all routing events during application bootstrap.

```ts
provideRouter(routes, withDebugTracing());
```

## Common Use Cases

- **Loading Indicators**: Show a spinner when `NavigationStart` fires and hide it on `NavigationEnd`/`Cancel`/`Error`.
- **Analytics**: Track page views by listening for `NavigationEnd`.
- **Scroll Management**: Respond to `Scroll` events for custom scroll behavior.
