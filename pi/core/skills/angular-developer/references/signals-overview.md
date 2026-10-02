# Angular Signals Overview

Signals are the foundation of reactivity in modern Angular applications. A **signal** is a wrapper around a value that notifies interested consumers when that value changes.

## Writable Signals (`signal`)

Use `signal()` to create state that can be directly updated.

```ts
import {signal} from '@angular/core';

// Create a writable signal
const count = signal(0);

// Read the value (always requires calling the getter function)
console.log(count());

// Update the value directly
count.set(3);

// Update based on the previous value
count.update((value) => value + 1);
```

### Exposing as Readonly

When exposing state from a service, it is a best practice to expose a readonly version to prevent external mutation.

```ts
private readonly _count = signal(0);
// Consumers can read this, but cannot call .set() or .update()
readonly count = this._count.asReadonly();
```

## Computed Signals (`computed`)

Use `computed()` to create read-only signals that derive their value from other signals.

- **Lazily Evaluated**: The derivation function doesn't run until the computed signal is read.
- **Memoized**: The result is cached. It only recalculates when one of the signals it depends on changes.
- **Dynamic Dependencies**: Only the signals _actually read_ during the derivation are tracked.

```ts
import {signal, computed} from '@angular/core';

const count = signal(0);
const doubleCount = computed(() => count() * 2);

// doubleCount automatically updates when count changes.
```

## Reactive Contexts

A **reactive context** is a runtime state where Angular monitors signal reads to establish a dependency.

Angular automatically enters a reactive context when evaluating:

- `computed` signals
- `effect` callbacks
- `linkedSignal` computations
- Component templates

### Untracked Reads (`untracked`)

If you need to read a signal inside a reactive context _without_ creating a dependency (so that the context doesn't re-run when the signal changes), use `untracked()`.

```ts
import {effect, untracked} from '@angular/core';

effect(() => {
  // This effect only runs when currentUser changes.
  // It does NOT run when counter changes, even though counter is read here.
  console.log(`User: ${currentUser()}, Count: ${untracked(counter)}`);
});
```

### Async Operations in Reactive Contexts

The reactive context is only active for **synchronous** code. Signal reads after an `await` will not be tracked. **Always read signals before asynchronous boundaries.**

```ts
// Incorrect: theme() is not tracked because it is read after await
effect(async () => {
  const data = await fetchUserData();
  console.log(theme());
});

// Correct: Read the signal before the await
effect(async () => {
  const currentTheme = theme();
  const data = await fetchUserData();
  console.log(currentTheme);
});
```
