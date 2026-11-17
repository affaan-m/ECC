# Testing with the RouterTestingHarness

When testing components that involve routing, it is crucial **not to mock the Router or related services**. Instead, use the `RouterTestingHarness`, which provides a robust and reliable way to test routing logic in an environment that closely mirrors a real application.

Using the harness ensures you are testing the actual router configuration, guards, and resolvers, leading to more meaningful tests.

## Setting Up for Router Testing

The `RouterTestingHarness` is the primary tool for testing routing scenarios. You also need to provide your test routes using the `provideRouter` function in your `TestBed` configuration.

### Example Setup

```ts
import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {RouterTestingHarness} from '@angular/router/testing';
import {Dashboard} from './dashboard.component';
import {HeroDetail} from './hero-detail.component';

describe('Dashboard Component Routing', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    // 1. Configure TestBed with test routes
    await TestBed.configureTestingModule({
      providers: [
        // Use provideRouter with your test-specific routes
        provideRouter([
          {path: '', component: Dashboard},
          {path: 'heroes/:id', component: HeroDetail},
        ]),
      ],
    }).compileComponents();

    // 2. Create the RouterTestingHarness
    harness = await RouterTestingHarness.create();
  });
});
```

### Key Concepts

1. **`provideRouter([...])`**: Provide a test-specific routing configuration. This should include the routes necessary for the component-under-test to function correctly.
2. **`RouterTestingHarness.create()`**: Asynchronously creates and initializes the harness and performs an initial navigation to the root URL (`/`).

## Writing Router Tests

Once the harness is created, you can use it to drive navigation and make assertions on the state of the router and the activated components.

### Example: Testing Navigation

```ts
it('should navigate to a hero detail when a hero is selected', async () => {
  // 1. Navigate to the initial component and get its instance
  const dashboard = await harness.navigateByUrl('/', Dashboard);

  // Suppose the dashboard has a method to select a hero
  const heroToSelect = {id: 42, name: 'Test Hero'};
  dashboard.selectHero(heroToSelect);

  // Wait for stability after the action that triggers navigation
  await harness.fixture.whenStable();

  // 2. Assert on the URL
  expect(harness.router.url).toEqual('/heroes/42');

  // 3. Get the activated component after navigation
  const heroDetail = await harness.getHarness(HeroDetail);

  // 4. Assert on the state of the new component
  expect(await heroDetail.componentInstance.hero.name).toBe('Test Hero');
});

it('should get the activated component directly', async () => {
  // Navigate and get the component instance in one step
  const dashboardInstance = await harness.navigateByUrl('/', Dashboard);

  expect(dashboardInstance).toBeInstanceOf(Dashboard);
});
```

### Best Practices

- **Navigate with the Harness:** Always use `harness.navigateByUrl()` to simulate navigation. This method returns a promise that resolves with the instance of the activated component.
- **Access the Router State:** Use `harness.router` to access the live router instance and assert on its state (e.g., `harness.router.url`).
- **Get Activated Components:** Use `harness.getHarness(ComponentType)` to get an instance of a component harness for the currently activated routed component, or `harness.routeDebugElement` to get the `DebugElement`.
- **Wait for Stability:** After performing an action that causes navigation, always `await harness.fixture.whenStable()` to ensure the routing is complete before making assertions.
