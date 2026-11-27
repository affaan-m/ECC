# Async Reactivity with `resource`

> [!IMPORTANT]
> The `resource` API is currently experimental in Angular.

A `Resource` incorporates asynchronous data fetching into Angular's signal-based reactivity. It executes an async loader function whenever its dependencies change, exposing the status and result as synchronous signals.

## Basic Usage

The `resource` function accepts an options object with two main properties:

1. `params`: A reactive computation (like `computed`). When signals read here change, the resource re-fetches.
2. `loader`: An async function that fetches data based on the parameters.

```ts
import { Component, resource, signal, computed } from '@angular/core';

@Component({...})
export class UserProfile {
  userId = signal('123');

  userResource = resource({
    // Reactively tracking userId
    params: () => ({ id: this.userId() }),

    // Executes whenever params change
    loader: async ({ params, abortSignal }) => {
      const response = await fetch(`/api/users/${params.id}`, { signal: abortSignal });
      if (!response.ok) throw new Error('Network error');
      return response.json();
    }
  });

  // Use the resource value in computed signals
  userName = computed(() => {
    if (this.userResource.hasValue()) {
      return this.userResource.value()?.name;
    } else {
      return 'Loading...';
    }
  });
}
```

## Aborting Requests

If the `params` signal changes while a previous loader is still running, the `Resource` will attempt to abort the outstanding request using the provided `abortSignal`. **Always pass `abortSignal` to your `fetch` calls.**

## Reloading Data

You can imperatively force the resource to re-run the loader without the params changing by calling `.reload()`.

```ts
this.userResource.reload();
```

## Resource Status Signals

The `Resource` object provides several signals to read its current state:

- `value()`: The resolved data, or `undefined`.
- `hasValue()`: Type-guard boolean. `true` if a value exists.
- `isLoading()`: Boolean indicating if the loader is currently running.
- `error()`: The error thrown by the loader, or `undefined`.
- `status()`: A string constant representing the exact state (`'idle'`, `'loading'`, `'resolved'`, `'error'`, `'reloading'`, `'local'`).

## Local Mutation

You can optimistically update the resource's value directly. This changes the status to `'local'`.

```ts
this.userResource.value.set({name: 'Optimistic Update'});
```

## Reactive Data Fetching with `httpResource`

If you are using Angular's `HttpClient`, prefer using `httpResource`. It is a specialized wrapper that leverages the Angular HTTP stack (including interceptors) while providing the same signal-based resource API.
