# Show Routes with Outlets

The `RouterOutlet` directive is a placeholder where Angular renders the component for the current URL.

## Basic Usage

Include `<router-outlet />` in your template. Angular inserts the routed component as a sibling immediately following the outlet.

```html
<app-header /> <router-outlet />
<!-- Route content appears here -->
<app-footer />
```

## Nested Outlets

Child routes require their own `<router-outlet />` within the parent component's template.

```ts
// Parent component template
<h1>Settings</h1>
<router-outlet /> <!-- Child components like Profile or Security render here -->
```

## Named Outlets (Secondary Routes)

Pages can have multiple outlets. Assign a `name` to an outlet to target it specifically. The default name is `'primary'`.

```html
<router-outlet />
<!-- Primary -->
<router-outlet name="sidebar" />
<!-- Secondary -->
```

Define the `outlet` in the route config:

```ts
{
  path: 'chat',
  component: Chat,
  outlet: 'sidebar'
}
```

## Outlet Lifecycle Events

`RouterOutlet` emits events when components are changed:

- `activate`: New component instantiated.
- `deactivate`: Component destroyed.
- `attach` / `detach`: Used with `RouteReuseStrategy`.

```html
<router-outlet (activate)="onActivate($event)" />
```

## Passing Data via `routerOutletData`

You can pass contextual data to the routed component using the `routerOutletData` input. The component accesses this via the `ROUTER_OUTLET_DATA` injection token as a signal.

```ts
// In Parent
<router-outlet [routerOutletData]="{ theme: 'dark' }" />

// In Routed Component
outletData = inject(ROUTER_OUTLET_DATA) as Signal<{ theme: string }>;
```
