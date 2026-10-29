# Navigate to Routes

Angular provides both declarative and programmatic ways to navigate between routes.

## Declarative Navigation (`RouterLink`)

Use the `RouterLink` directive on anchor elements.

```ts
import {RouterLink, RouterLinkActive} from '@angular/router';

@Component({
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav>
      <a routerLink="/dashboard" routerLinkActive="active-link">Dashboard</a>
      <a [routerLink]="['/user', userId]">Profile</a>
    </nav>
  `,
})
export class Nav {
  userId = '123';
}
```

- **Absolute Paths**: Start with `/` (e.g., `/settings`).
- **Relative Paths**: No leading `/`. Use `../` to go up a level.

## Programmatic Navigation (`Router`)

Inject the `Router` service to navigate via TypeScript code.

### `router.navigate()`

Uses an array of commands.

```ts
private router = inject(Router);
private route = inject(ActivatedRoute);

// Standard navigation
this.router.navigate(['/profile']);

// With parameters
this.router.navigate(['/search'], {
  queryParams: { q: 'angular' },
  fragment: 'results'
});

// Relative navigation
this.router.navigate(['edit'], { relativeTo: this.route });
```

### `router.navigateByUrl()`

Uses a string path. Ideal for absolute navigation or full URLs.

```ts
this.router.navigateByUrl('/products/123?view=details');

// Replace current entry in history
this.router.navigateByUrl('/login', {replaceUrl: true});
```

## URL Parameters

- **Route Params**: Part of the path (e.g., `/user/123`).
- **Query Params**: After the `?` (e.g., `/search?q=query`).
- **Matrix Params**: Scoped to a segment (e.g., `/products;category=books`).
