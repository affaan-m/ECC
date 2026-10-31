# Signal Forms

Signal Forms are recommended for new forms when the target Angular version supports them. They provide a reactive, type-safe, and model-driven way to manage form state using Angular Signals.

When using Signal Forms, do not use `null` as a value or type of any fields.

## Imports

You can import the following from `@angular/forms/signals`:

```ts
import {
  form,
  FormField,
  submit,
  // Rules for field state
  disabled,
  hidden,
  readonly,
  debounce,
  // Schema helpers
  applyWhen,
  applyEach,
  schema,
  // Custom validation
  validate,
  validateHttp,
  validateStandardSchema,
  // Metadata
  metadata,
} from '@angular/forms/signals';
```

## Creating a Form

Use the `form()` function with a Signal model. The structure of the form is derived directly from the model.

```ts
import {Component, signal} from '@angular/core';
import {form, FormField} from '@angular/forms/signals';

@Component({
  // ...
  imports: [FormField],
})
export class Example {
  // 1. Define your model with initial values (avoid undefined)
  userModel = signal({
    name: '', // CRITICAL: NEVER use null or undefined as initial values
    email: '',
    age: 0, // Use 0 for numbers, NOT null
    address: {
      street: '',
      city: '',
    },
    hobbies: [] as string[], // Use [] for arrays, NOT null
  });

  // WRONG - DO NOT DO THIS:
  // badModel = signal({
  //   name: null,      // ERROR: use '' instead
  //   age: null,       // ERROR: use 0 instead
  //   items: null      // ERROR: use [] instead
  // });

  // 2. Create the form
  userForm = form(this.userModel);
}
```

## Validation

Import validators from `@angular/forms/signals`.

```ts
import {required, email, min, max, minLength, maxLength, pattern} from '@angular/forms/signals';
```

Use them in the schema function passed to `form()`:

```ts
userForm = form(this.userModel, (schemaPath) => {
  // Required
  required(schemaPath.name, {message: 'Name is required'});

  // Conditional required.
  required(schemaPath.name, {
    when({valueOf}) {
      return valueOf(schemaPath.age) > 10;
    },
  });
  // when is only available for required
  // Do NOT do this: pattern(p.name, /xxx/, {when /* ERROR */)

  // Email
  email(schemaPath.email, {message: 'Invalid email'});

  // Min/Max for numbers
  min(schemaPath.age, 18);
  max(schemaPath.age, 100);

  // MinLength/MaxLength for strings/arrays
  minLength(schemaPath.password, 8);
  maxLength(schemaPath.description, 500);

  // Pattern (Regex)
  pattern(schemaPath.zipCode, /^\d{5}$/);
});
```

## FieldState vs FormField: The Parental Requirement

It's important to understand the difference between **FormField** (the structure) and **FieldState** (the actual data/signals).

**RULE**: You must **CALL** a field as a function to access its state signals (valid, touched, dirty, hidden, etc.).

```ts
// f is a FormField (structural)
const f = form(signal({cat: {name: 'pirojok-the-cat', age: 5}}));

f.cat.name; // FormField: You can't get flags from here!
f.cat.name.touched(); // ERROR: touched() does not exist on FormField

f.cat.name(); // FieldState: Calling it gives you access to signals
f.cat.name().touched(); // VALID: Accessing the signal
f.cat().name.touched(); // ERROR: f.cat() is state, it doesn't have children!
```

Similarly in a template:

```html
<!-- WRONG: Property 'hidden' does not exist on type 'FormField' -->
@if (bookingForm.hotelDetails.hidden()) { ... }

<!-- RIGHT: Call it first -->
@if (bookingForm.hotelDetails().hidden()) { ... }
```

## Disabled / Readonly / Hidden

Control field status using rules in the schema.

```ts
import {disabled, readonly, hidden} from '@angular/forms/signals';

userForm = form(this.userModel, (schemaPath) => {
  // Conditionally disabled
  disabled(schemaPath.password, ({valueOf}) => !valueOf(schemaPath.createAccount));

  // Conditionally hidden (does NOT remove from model, just marks as hidden)
  hidden(schemaPath.shippingAddress, ({valueOf}) => valueOf(schemaPath.sameAsBilling));

  // Readonly
  readonly(schemaPath.username);
});
```

## Binding

Import `FormField` and use the `[formField]` directive.

```ts
import {FormField} from '@angular/forms/signals';
```

All props on state, such as `disabled`, `hidden`, `readonly` and `name` are bound automatically.
Do _NOT_ bind the `name` field.

**CRITICAL: FORBIDDEN ATTRIBUTES**
When using `[formField]`, you MUST NOT set the following attributes in the template (either static or bound):

- `min`, `max` (Use validators in the schema instead)
- `value`, `[value]`, `[attr.value]` (Already handled by `[formField]`)
- `[attr.min]`, `[attr.max]`
- `[disabled]`, `[readonly]` (Already handled by `[formField]`)

Do NOT do this: `<input min="1" [formField]>` or `<input [value]="val" [formField]>`.

```html
<!-- Input -->
<input [formField]="userForm.name" />

<!-- Checkbox -->
<input type="checkbox" [formField]="userForm.isAdmin" />

<!-- Select -->
<select [formField]="userForm.country">
  <option value="us">US</option>
</select>

<!-- userForm.name can NOT be nullable, because input does not accept null-->
<input [formField]="userForm.name" />
```

## Reactive Forms

**Do NOT import** `FormControl`, `FormGroup`, `FormArray`, or `FormBuilder` from `@angular/forms`. Signal Forms replace these concepts entirely.
Signal forms does NOT have a builder.

## Accessing State

Each field in the form is a function that returns its state.

```ts
// Access the field by calling it
const emailState = this.userForm.email();

// Value (WritableSignal)
const value = this.userForm().value();

// Validation State (Signals)
const isValid = this.userForm().valid();
const isInvalid = this.userForm().invalid();
const errors = this.userForm().errors(); // Array of errors
const isPending = this.userForm().pending(); // Async validation pending

// Interaction State (Signals)
const isTouched = this.userForm().touched();
const isDirty = this.userForm().dirty();

// Availability State (Signals)
const isDisabled = this.userForm().disabled();
const isHidden = this.userForm().hidden();
const isReadonly = this.userForm().readonly();
```

IMPORTANT!: Make sure to call the field to get it state.

```ts
form().invalid()
form.field().dirty()
form.field.subfield().touched()
form.a.b.c.d().value()
form.address.ssn().pending()
form().reset()

// The only exception is length:
form.children.length
form.length // NOTE: no parenthesis!
form.client.addresses.length  // No "()"

@for (income of form.addresses; track $index) {/**/}
```

## Submitting

Use the `submit()` function. It automatically marks all fields as touched before running the action.

**CRITICAL**: The callback to `submit()` MUST be `async` and MUST return a Promise.

```ts
import { submit } from '@angular/forms/signals';

// CORRECT - async callback
onSubmit() {
  submit(this.userForm, async () => {
    // This only runs if the form is valid
    await this.apiService.save(this.userModel());
    console.log('Saved!');
  });
}

// WRONG - missing async keyword
onSubmit() {
  submit(this.userForm, () => {  // ERROR: must be async
    console.log('Saved!');
  });
}
```

## Handling Errors

`field().errors()` returns the errors array of ValidationError:

```ts
interface ValidationError {
  readonly kind: string;
  readonly message?: string;
}
```

Do _NOT_ return null from validators.
When there are no errors, return undefined

### Context

Functions passed to rules like `validate()`, `disabled()`, `applyWhen` take a context object. It is **CRITICAL** to understand its structure:

```ts
validate(
  schemaPath.username,
  ({
    value, // Signal<T>: Writable current value of the field
    fieldTree, // FieldTree<T>: Sub-fields (if it's a group/array)
    state, // FieldState<T>: Access flags like state.valid(), state.dirty()
    valueOf, // (path) => T: Read values of OTHER fields (tracking dependencies), e.g. valueOf(schemaPath.password)
    stateOf, // (path) => FieldState: Access state (valid/dirty) of OTHER fields, e.g. stateOf(schemaPath.password).valid()
    pathKeys, // Signal<string[]>: Path from root to this field
  }) => {
    // WRONG: if (touched()) ... (touched is not in context)
    // RIGHT: if (state.touched()) ...

    if (value() === 'admin') {
      return {kind: 'reserved', message: 'Username admin is reserved'};
    }
  },
);
```

### IMPORTANT: Paths are NOT Signals

Inside the `form()` callback, `schemaPath` and its children (e.g., `schemaPath.user.name`) are **NOT** signals and are **NOT** callable.

```ts
// WRONG - This will throw an error:
applyWhen(p.ssn, () => p.ssn().touched(), (ssnField) => { ... });

// RIGHT - Use stateOf() to get the state of a path:
applyWhen(p.ssn, ({ stateOf }) => stateOf(p.ssn).touched(), (ssnField) => { ... });

// RIGHT - Use valueOf() to get the value of a path:
applyWhen(p.ssn, ({ valueOf }) => valueOf(p.ssn) !== '', (ssnField) => { ... });
```

### Multiple Items

- Use `applyEach` for applying rules per item.
- **CRITICAL**: `applyEach` callback takes ONLY ONE argument (the item path), NOT two:

```ts
// CORRECT - single argument
applyEach(s.items, (item) => {
  required(item.name);
});

// WRONG - do NOT pass index
applyEach(s.items, (item, index) => {
  // ERROR: callback takes 1 argument
  required(item.name);
});
```

- In the template use `@for` to iterate over the items.
- To remove an item from an array, just remove appropriate item from the array in the data.
- **`select` binding**: You CAN bind to `<select [formField]="form.country">`. Ensure options have `value` attributes.

### Nested @for Loops

**CRITICAL**: Angular does NOT have `$parent`. In nested loops, store outer index in a variable:

```html
<!-- WRONG - $parent does not exist -->
@for (item of form.items; track $index) { @for (option of item.options; track $index) {
<button (click)="removeOption($parent.$index, $index)">Remove</button>
<!-- ERROR -->
} }

<!-- CORRECT - use let to store outer index -->
@for (item of form.items; track $index; let outerIndex = $index) { @for (option of item.options;
track $index) {
<button (click)="removeOption(outerIndex, $index)">Remove</button>
} }
```

### Disabling Form Button

```html
<button [disabled]="form().invalid() || form().pending()" />
<!-- Or -->
<button [disabled]="taxForm.invalid()" />
```

Do NOT use `[disabled]` on an input. `[formField]` will do this.
Do NOT use `[readonly]` on an input. `[formField]` will do this.
If you need to disable or readonly a field, use `disabled()` or `readonly()` rules in the schema.

### Async Validation

Do not use `validate()` for async, instead use `validateAsync()`:

**CRITICAL**:

1. The `params` option MUST be a function that returns the value to validate.
2. The `onError` handler is **REQUIRED** - it is NOT optional!

```ts
import {resource} from '@angular/core';
import {validateAsync} from '@angular/forms/signals';

userForm = form(this.userModel, (s) => {
  validateAsync(s.username, {
    // 1. MUST be a function - params takes context and returns the value
    params: ({value}) => value(),

    // 2. Create the resource - factory receives a Signal
    factory: (username) =>
      resource({
        params: username, // Use 'params' in resource()
        loader: async ({params: value}) => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return value === 'taken';
        },
      }),

    // 3. Map success to errors
    onSuccess: (isTaken) =>
      isTaken ? {kind: 'taken', message: 'Username is already taken'} : undefined,

    // 4. Handle errors - THIS IS REQUIRED!
    onError: () => ({kind: 'error', message: 'Validation failed'}),
  });
});
```

**WRONG Examples:**

```ts
// WRONG - params must be a function
validateAsync(s.username, {
  params: s.username, // ERROR: must be ({ value }) => value()
  // ...
});

// WRONG - missing onError (it's required!)
validateAsync(s.username, {
  params: ({value}) => value(),
  factory: (username) =>
    resource({
      /* ... */
    }),
  onSuccess: (result) => (result ? {kind: 'error'} : undefined),
  // ERROR: 'onError' is missing but required!
});
```

### Using Resource

**CRITICAL**: In Angular's `resource()`, use `params` for the input signal.

```ts
// CORRECT
resource({
  params: mySignal,
  loader: async ({params: value}) => {
    /* ... */
  },
});

// WRONG
resource({
  request: mySignal, // ERROR: should be 'params'
  loader: async ({request}) => {
    /* ... */
  },
});
```

Use `debounce()` to delay synchronization between the UI and the model.

```ts
import {debounce} from '@angular/forms/signals';

userForm = form(this.userModel, (s) => {
  // Delay model updates by 300ms
  debounce(s.username, 300);
});
```

### Conditional Validation

```ts
form(
  data,
  (path) => {
    applyWhen(
      name,
      ({value}) => value() !== 'admin',
      (namePath) => {
        validate(namePath.last /* ... */);
        disable(namePath.last /* ... */);
      },
    );
  },
  {injector: TestBed.inject(Injector)},
);
```

`applyWhen` passes the path mapped to the first argument.
If you need parent field, just pass it to `applyWhen`:

```ts
form(
  data,
  (path) => {
    applyWhen(
      cat,
      ({value}) => value().name !== 'admin',
      (catPath) => {
        require(cat.catPath /* ... */);
      },
    );
  },
  {injector: TestBed.inject(Injector)},
);
```

## Common Pitfalls (DO NOT DO THESE)

| Error Scenario         | WRONG (Common Mistake)                        | RIGHT (Correct Way)                                         |
| :--------------------- | :-------------------------------------------- | :---------------------------------------------------------- |
| **Accessing Flags**    | `form.field.valid()`                          | `form.field().valid()`                                      |
| **Accessing value**    | `form.field.value()`                          | `form.field().value()`                                      |
| **Setting value**      | `form.field.set(x)`                           | Update model signal: `this.model.update(...)`               |
| **Form root flags**    | `form.invalid()`                              | `form().invalid()`                                          |
| **Double-calling**     | `form.field()()`                              | `form.field().value()`                                      |
| **Rules Context**      | `({ touched }) => touched()`                  | `({ state }) => state.touched()`                            |
| **Calling Paths**      | `applyWhen(p.foo, () => p.foo() === 'x')`     | `applyWhen(p.foo, ({ valueOf }) => valueOf(p.foo) === 'x')` |
| **applyWhen args**     | `applyWhen(condition, () => {...})`           | `applyWhen(path, condition, schemaFn)` - needs 3 args       |
| **Array length**       | `form.items().length`                         | `form.items.length` (structural)                            |
| **Multi-select array** | `<select [formField]="form.tags">` (string[]) | Use checkboxes for array fields                             |
| **readonly attribute** | `<input readonly [formField]>`                | Use `readonly()` rule in schema                             |
| **min/max attributes** | `<input min="1" max="10">`                    | Use `min()` and `max()` rules in schema                     |
| **value binding**      | `<input [value]="val">`                       | Do NOT use `[value]` with `[formField]`                     |
| **when option**        | `pattern(p.x, /.../, {when: ...})`            | `when` only works with `required()`                         |
| **Submit callback**    | `submit(form, () => { ... })`                 | `submit(form, async () => { ... })`                         |
| **Async params**       | `params: s.field`                             | `params: ({ value }) => value()`                            |
| **Async onError**      | Omitting `onError`                            | `onError` is REQUIRED in `validateAsync`                    |
| **resource() API**     | `request: signal`                             | `params: signal`                                            |
| **applyEach args**     | `applyEach(s.items, (item, index) => ...)`    | `applyEach(s.items, (item) => ...)`                         |
| **Nested @for**        | `$parent.$index`                              | Use `let outerIndex = $index`                               |
| **FormState import**   | `import { FormState }`                        | `FormState` does not exist, use `FieldState`                |
| **Null in model**      | `signal({ name: null })`                      | `signal({ name: '' })` or `signal({ age: 0 })`              |
| **Validate syntax**    | `validate(s.field, { value } => ...)`         | `validate(s.field, ({ value }) => ...)`                     |
| **Checkbox Array**     | `[formField]="form.tags"` (string[])          | Checkboxes ONLY bind to `boolean`                           |

## Big Form Example

### `src/app/app.ts`

```ts
import {Component, signal, ChangeDetectionStrategy} from '@angular/core';
import {
  form,
  FormField,
  submit,
  required,
  email,
  min,
  hidden,
  applyEach,
  validate,
} from '@angular/forms/signals';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormField],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  model = signal({
    personalInfo: {
      firstName: '',
      lastName: '',
      email: '',
      age: 0,
    },
    tripDetails: {
      destination: 'Mars',
      launchDate: '',
    },
    package: {
      tier: 'economy',
      extras: [] as string[],
    },
    companions: [] as Array<{name: string; relation: string}>,
  });

  bookingForm = form(this.model, (s) => {
    required(s.personalInfo.firstName, {message: 'First name is required'});
    required(s.personalInfo.lastName, {message: 'Last name is required'});
    required(s.personalInfo.email, {message: 'Email is required'});
    email(s.personalInfo.email, {message: 'Invalid email address'});
    required(s.personalInfo.age, {message: 'Age is required'});
    min(s.personalInfo.age, 18, {message: 'Must be at least 18'});

    required(s.tripDetails.destination);
    required(s.tripDetails.launchDate);
    validate(s.tripDetails.launchDate, ({value}) => {
      const date = new Date(value());
      if (isNaN(date.getTime())) return undefined;
      const today = new Date();
      if (date < today) {
        return {kind: 'pastData', message: 'Launch date must be in the future'};
      }
      return undefined;
    });

    // valueOf is used to access values of other fields in rules
    hidden(s.package.extras, ({valueOf}) => valueOf(s.package.tier) === 'economy');

    applyEach(s.companions, (companion) => {
      required(companion.name, {message: 'Companion name required'});
      required(companion.relation, {message: 'Relation required'});
    });
  });

  addCompanion() {
    this.model.update((m) => ({
      ...m,
      companions: [...m.companions, {name: '', relation: ''}],
    }));
  }

  removeCompanion(index: number) {
    this.model.update((m) => ({
      ...m,
      companions: m.companions.filter((_, i) => i !== index),
    }));
  }

  onSubmit() {
    // CRITICAL: submit callback MUST be async
    submit(this.bookingForm, async () => {
      console.log('Booking Confirmed:', this.model());
      // If you need to do async work:
      // await this.apiService.save(this.model());
    });
  }
}
```

### `src/app/app.html`

```html
<form (submit)="onSubmit(); $event.preventDefault()">
  <h1>Interstellar Booking</h1>

  <section>
    <h2>Personal Info</h2>

    <label>
      First Name
      <input [formField]="bookingForm.personalInfo.firstName" />
      @if (bookingForm.personalInfo.firstName().touched() &&
      bookingForm.personalInfo.firstName().errors().length) {
      <span>{{ bookingForm.personalInfo.firstName().errors()[0].message }}</span>
      }
    </label>

    <label>
      Last Name
      <input [formField]="bookingForm.personalInfo.lastName" />
      @if (bookingForm.personalInfo.lastName().touched() &&
      bookingForm.personalInfo.lastName().errors().length) {
      <span>{{ bookingForm.personalInfo.lastName().errors()[0].message }}</span>
      }
    </label>

    <label>
      Email
      <input type="email" [formField]="bookingForm.personalInfo.email" />
      @if (bookingForm.personalInfo.email().touched() &&
      bookingForm.personalInfo.email().errors().length) {
      <span>{{ bookingForm.personalInfo.email().errors()[0].message }}</span>
      }
    </label>

    <label>
      Age
      <input type="number" [formField]="bookingForm.personalInfo.age" />
      @if (bookingForm.personalInfo.age().touched() &&
      bookingForm.personalInfo.age().errors().length) {
      <span>{{ bookingForm.personalInfo.age().errors()[0].message }}</span>
      }
    </label>
  </section>

  <section>
    <h2>Trip Details</h2>

    <label>
      Destination
      <select [formField]="bookingForm.tripDetails.destination">
        <option value="Mars">Mars</option>
        <option value="Moon">Moon</option>
        <option value="Titan">Titan</option>
      </select>
    </label>

    <label>
      Launch Date
      <input type="date" [formField]="bookingForm.tripDetails.launchDate" />
      @if (bookingForm.tripDetails.launchDate().touched() &&
      bookingForm.tripDetails.launchDate().errors().length) {
      <span>{{ bookingForm.tripDetails.launchDate().errors()[0].message }}</span>
      }
    </label>
  </section>

  <section>
    <h2>Package</h2>

    <label>
      <input type="radio" value="economy" [formField]="bookingForm.package.tier" />
      Economy
    </label>
    <label>
      <input type="radio" value="business" [formField]="bookingForm.package.tier" />
      Business
    </label>
    <label>
      <input type="radio" value="first" [formField]="bookingForm.package.tier" />
      First Class
    </label>

    @if (!bookingForm.package.extras().hidden()) {
    <div>
      <h3>Extras</h3>
      <!-- Multi-select for arrays must use select multiple -->
      <select multiple [formField]="bookingForm.package.extras">
        <option value="wifi">WiFi</option>
        <option value="gym">Gym</option>
      </select>
    </div>
    }
  </section>

  <section>
    <h2>Companions</h2>
    <button type="button" (click)="addCompanion()">Add Companion</button>

    @for (companion of bookingForm.companions; track $index) {
    <div>
      <input [formField]="companion.name" placeholder="Name" />
      @if (companion.name().touched() && companion.name().errors().length) {
      <span>{{ companion.name().errors()[0].message }}</span>
      }

      <input [formField]="companion.relation" placeholder="Relation" />
      @if (companion.relation().touched() && companion.relation().errors().length) {
      <span>{{ companion.relation().errors()[0].message }}</span>
      }

      <button type="button" (click)="removeCompanion($index)">Remove</button>
    </div>
    }
  </section>

  <button [disabled]="bookingForm().invalid()">Submit</button>
</form>
```

## Recovering from Build Errors

If you encounter build errors, here are the most common fixes:

### `Property 'value' does not exist on type 'FieldTree'`

**Problem**: Accessing `.value()` directly on a field without calling it first.

```ts
// WRONG
const val = this.form.field.value();
// RIGHT
const val = this.form.field().value();
```

### `Property 'set' does not exist on type 'FieldTree'`

**Problem**: Trying to set values on the form tree. Signal Forms are model-driven.

```ts
// WRONG
this.form.address.street.set('Main St');
// RIGHT - update the model signal instead
this.model.update((m) => ({...m, address: {...m.address, street: 'Main St'}}));
```

### `Type 'string[]' is not assignable to type 'string'`

**Problem**: Binding `[formField]` to an array field with a single-value `<select>`.

```html
<!-- WRONG - assignees is string[], select expects string -->
<select [formField]="form.assignees">
  ...
</select>

<!-- RIGHT - Use select multiple for array fields -->
<select multiple [formField]="form.assignees">
  <option value="us">US</option>
</select>
```
