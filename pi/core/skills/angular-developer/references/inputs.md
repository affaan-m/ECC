# Inputs

Inputs allow data to flow from a parent component to a child component. Angular recommends using the signal-based `input` API for modern applications.

## Signal-based Inputs

Declare inputs using the `input()` function. This returns an `InputSignal`.

```ts
import {Component, input, computed} from '@angular/core';

@Component({
  selector: 'app-user',
  template: `<p>User: {{ name() }} ({{ age() }})</p>`,
})
export class User {
  // Optional input with default value
  name = input('Guest');

  // Required input
  age = input.required<number>();

  // Inputs are reactive signals
  label = computed(() => `Name: ${this.name()}`);
}
```

### Usage in Template

```html
<app-user [name]="userName" [age]="25" />
```

## Configuration Options

The `input` function accepts a config object:

- **Alias**: Change the property name used in templates.
- **Transform**: Modify the value before it reaches the component.

```ts
import { input, booleanAttribute } from '@angular/core';

@Component({...})
export class CustomButton {
  // Alias example
  label = input('', { alias: 'btnLabel' });

  // Transform example using built-in helper
  disabled = input(false, { transform: booleanAttribute });
}
```

## Model Inputs (Two-Way Binding)

Use `model()` to create an input that supports two-way data binding.

```ts
@Component({
  selector: 'custom-counter',
  template: `<button (click)="increment()">+</button>`,
})
export class CustomCounter {
  value = model(0);

  increment() {
    this.value.update((v) => v + 1);
  }
}
```

### Usage

```html
<!-- Two-way binding with a signal -->
<custom-counter [(value)]="mySignal" />

<!-- Two-way binding with a plain property -->
<custom-counter [(value)]="myProperty" />
```

## Decorator-based Inputs (@Input)

The legacy API remains supported but is not recommended for new code.

```ts
import { Component, Input } from '@angular/core';

@Component({...})
export class Legacy {
  @Input({ required: true }) value = 0;
  @Input({ transform: trimString }) label = '';
}
```

## Best Practices

- **Prefer Signals**: Use `input()` instead of `@Input()` for better reactivity and type safety.
- **Required Inputs**: Use `input.required()` for mandatory data to get build-time errors.
- **Pure Transforms**: Ensure input transform functions are pure and statically analyzable.
- **Avoid Collisions**: Do not use input names that collide with standard DOM properties (e.g., `id`, `title`).
