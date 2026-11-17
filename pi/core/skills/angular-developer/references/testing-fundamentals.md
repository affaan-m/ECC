# Testing Fundamentals

This guide covers the fundamental principles and practices for writing Angular unit and component tests. Use the runner already configured in the project.

## Core Philosophy: Async-First

Modern Angular applications often schedule state changes asynchronously, especially when using signals or zoneless change detection. Tests should account for this.

Prefer the "Act, Wait, Assert" pattern:

1. **Act:** Update state or perform an action (e.g., set a component input, click a button).
2. **Wait:** Use `await fixture.whenStable()` to allow the framework to process the scheduled update and render the changes.
3. **Assert:** Verify the outcome.

### Basic Test Structure Example

```ts
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MyComponent} from './my.component';

describe('MyComponent', () => {
  let component: MyComponent;
  let fixture: ComponentFixture<MyComponent>;
  let h1: HTMLElement;

  beforeEach(async () => {
    // 1. Configure the test module
    await TestBed.configureTestingModule({
      imports: [MyComponent],
    }).compileComponents();

    // 2. Create the component fixture
    fixture = TestBed.createComponent(MyComponent);
    component = fixture.componentInstance;
    h1 = fixture.nativeElement.querySelector('h1');
  });

  it('should display the default title', async () => {
    // ACT: (Implicit) Component is created with default state.
    // WAIT for initial data binding.
    await fixture.whenStable();
    // ASSERT the initial state.
    expect(h1.textContent).toContain('Default Title');
  });

  it('should display a different title after a change', async () => {
    // ACT: Change the component's title property.
    component.title.set('New Test Title');

    // WAIT for the asynchronous update to complete.
    await fixture.whenStable();

    // ASSERT the DOM has been updated.
    expect(h1.textContent).toContain('New Test Title');
  });
});
```

## TestBed and ComponentFixture

- **`TestBed`**: The primary utility for creating a test-specific Angular module. Use `TestBed.configureTestingModule({...})` in your `beforeEach` to declare components, provide services, and set up imports needed for your test.
- **`ComponentFixture`**: A handle on the created component instance and its environment.
  - `fixture.componentInstance`: Access the component's class instance.
  - `fixture.nativeElement`: Access the component's root DOM element.
  - `fixture.debugElement`: An Angular-specific wrapper around the `nativeElement` that provides safer, platform-agnostic ways to query the DOM (e.g., `debugElement.query(By.css('p'))`).
