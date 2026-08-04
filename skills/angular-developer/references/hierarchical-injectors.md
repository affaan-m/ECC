# Hierarchical Injectors

Angular's dependency injection system is hierarchical, meaning services can be scoped to different levels of the application.

## Types of Injector Hierarchies

1. **`EnvironmentInjector` Hierarchy**: Configured via `@Injectable({ providedIn: 'root' })` or `ApplicationConfig.providers` during bootstrap. These are global singletons.
2. **`ElementInjector` Hierarchy**: Created implicitly at each DOM element. Configured via the `providers` or `viewProviders` array in `@Component()` or `@Directive()`.

## Resolution Rules

When a dependency is requested, Angular resolves it in two phases:

1. It searches up the **`ElementInjector`** tree, starting from the requesting component/directive up to the root element.
2. If not found, it searches the **`EnvironmentInjector`** tree, starting from the closest environment injector up to the root.
3. If still not found, it throws an error (unless marked optional).

## Resolution Modifiers

You can alter how Angular searches for a dependency using the options object in `inject()`:

- **`optional`**: If the dependency isn't found, return `null` instead of throwing an error.
- **`self`**: Only check the current `ElementInjector`. Do not look up the parent tree.
- **`skipSelf`**: Start searching in the parent `ElementInjector`, skipping the current element.
- **`host`**: Stop searching when reaching the host component's view boundary.

```ts
@Component({...})
export class Example {
  // Returns null if not found instead of crashing
  optionalService = inject(MyService, { optional: true });

  // Skips this component's providers, looks at parent
  parentService = inject(ParentService, { skipSelf: true });
}
```

## `providers` vs `viewProviders`

When providing a service at the component level:

- **`providers`**: The service is available to the component, its view (template), and any **projected content** (`<ng-content>`).
- **`viewProviders`**: The service is available to the component and its view, but **NOT** to projected content. Use this to isolate services from content passed in by consumers.
