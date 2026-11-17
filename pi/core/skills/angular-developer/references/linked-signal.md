# Dependent State with `linkedSignal`

The `linkedSignal` function lets you create writable state that is intrinsically linked to some other state. It is perfect for state that needs a default value derived from an input or another signal, but can still be independently modified by the user.

If the source state changes, the `linkedSignal` resets to a new computed value.

## Basic Usage

When you only need to recompute based on a source, pass a computation function. `linkedSignal` works like `computed`, but the resulting signal is writable (you can call `.set()` or `.update()` on it).

```ts
import { Component, signal, linkedSignal } from '@angular/core';

@Component({...})
export class ShippingMethodPicker {
  shippingOptions = signal(['Ground', 'Air', 'Sea']);

  // Defaults to the first option.
  // If shippingOptions changes, selectedOption resets to the new first option.
  selectedOption = linkedSignal(() => this.shippingOptions()[0]);

  changeShipping(index: number) {
    // We can still manually update this signal!
    this.selectedOption.set(this.shippingOptions()[index]);
  }
}
```

## Advanced Usage: Accounting for Previous State

Sometimes, when the source state changes, you want to preserve the user's manual selection if it is still valid. To do this, use the object syntax providing `source` and `computation`.

The `computation` function receives the new value of the source, and a `previous` object containing the previous source value and the previous `linkedSignal` value.

```ts
interface ShippingMethod { id: number; name: string; }

@Component({...})
export class ShippingMethodPicker {
  shippingOptions = signal<ShippingMethod[]>([
    {id: 0, name: 'Ground'}, {id: 1, name: 'Air'}, {id: 2, name: 'Sea'}
  ]);

  selectedOption = linkedSignal<ShippingMethod[], ShippingMethod>({
    source: this.shippingOptions,
    computation: (newOptions, previous) => {
      // If the newly loaded options still contain the user's previously
      // selected option, keep it selected. Otherwise, reset to the first option.
      return newOptions.find(opt => opt.id === previous?.value.id) ?? newOptions[0];
    }
  });
}
```

### When to use `linkedSignal` vs `computed` vs `effect`

- Use `computed`: When state is **strictly** derived from other state and should never be manually updated.
- Use `linkedSignal`: When state is derived from other state, but the user **must** be able to override or manually update it.
- **Never** use `effect` to sync one piece of state to another. That is an anti-pattern. Use `computed` or `linkedSignal` instead.
