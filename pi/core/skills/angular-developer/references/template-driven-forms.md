# Template-Driven Forms

Template-driven forms use two-way data binding (`[(ngModel)]`) to update the data model in the component as changes are made in the template and vice versa. They are ideal for simple forms and use directives in the HTML template to manage form state and validation.

## Core Directives

Template-driven forms rely on the `FormsModule` which provides these key directives:

- `NgModel`: Reconciles value changes in the form element with the data model (`[(ngModel)]`).
- `NgForm`: Automatically creates a top-level `FormGroup` bound to the `<form>` tag.
- `NgModelGroup`: Creates a nested `FormGroup` bound to a DOM element.

## Setup

First, import `FormsModule` into your component or module.

```ts
import {Component} from '@angular/core';
import {FormsModule} from '@angular/forms';

@Component({
  selector: 'app-user-form',
  imports: [FormsModule],
  templateUrl: './user-form.component.html',
})
export class UserForm {
  user = {name: '', role: 'Guest'};

  onSubmit() {
    console.log('Form submitted!', this.user);
  }
}
```

## Building the Form Template

### Two-Way Binding with `[(ngModel)]`

Use `[(ngModel)]` on input elements. **Every element using `[(ngModel)]` MUST have a `name` attribute.** Angular uses the `name` attribute to register the control with the parent `NgForm`.

```html
<form #userForm="ngForm" (ngSubmit)="onSubmit()">
  <!-- Basic Input -->
  <div>
    <label for="name">Name:</label>
    <input type="text" id="name" required [(ngModel)]="user.name" name="name" #nameCtrl="ngModel" />
  </div>

  <!-- Select Box -->
  <div>
    <label for="role">Role:</label>
    <select id="role" [(ngModel)]="user.role" name="role">
      <option value="Admin">Admin</option>
      <option value="Guest">Guest</option>
    </select>
  </div>

  <!-- Submit Button (disabled if form is invalid) -->
  <button type="submit" [disabled]="!userForm.form.valid">Submit</button>
</form>
```

## Form and Control State

Angular automatically applies CSS classes to controls and forms based on their state:

| State          | Class if True                     | Class if False |
| :------------- | :-------------------------------- | :------------- |
| Visited        | `ng-touched`                      | `ng-untouched` |
| Value Changed  | `ng-dirty`                        | `ng-pristine`  |
| Value is Valid | `ng-valid`                        | `ng-invalid`   |
| Form Submitted | `ng-submitted` (on `<form>` only) | -              |

You can use these classes to provide visual feedback in your CSS:

```css
.ng-valid[required],
.ng-valid.required {
  border-left: 5px solid #42a948; /* green */
}
.ng-invalid:not(form) {
  border-left: 5px solid #a94442; /* red */
}
```

## Validation and Error Messages

To display error messages conditionally, export the `ngModel` directive to a template reference variable (e.g., `#nameCtrl="ngModel"`).

```html
<input type="text" id="name" required [(ngModel)]="user.name" name="name" #nameCtrl="ngModel" />

<!-- Show error only if the control is invalid AND (touched OR dirty) -->
@if (nameCtrl.invalid && (nameCtrl.dirty || nameCtrl.touched)) {
<div class="alert alert-danger">
  @if (nameCtrl.errors?.['required']) {
  <div>Name is required.</div>
  }
</div>
}
```

## Submitting the Form

1. Use the `(ngSubmit)` event on the `<form>` element.
2. Bind the submit button's disabled state to the overall form validity using the `NgForm` template reference variable (e.g., `[disabled]="!userForm.form.valid"`).

## Resetting the Form

To programmatically reset the form to its pristine state (clearing values and validation flags), use the `reset()` method on the `NgForm` instance.

```html
<button type="button" (click)="userForm.reset()">Reset</button>
```
