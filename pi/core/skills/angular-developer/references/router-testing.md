# Testing with the RouterTestingHarness

When testing components that involve routing, it is crucial **not to mock the Router or related services**. Instead, use the `RouterTestingHarness`, which provides a robust and reliable way to test routing logic in an environment that closely mirrors a real application.

Using the harness ensures you are testing the actual router configuration, guards, and resolvers, leading to more meaningful tests.

## Setting Up for Router Testing

The `RouterTestingHarness` is the primary tool for testing routing scenarios. You also need to provide your test routes using the `provideRouter` function in your `TestBed` configuration.

### Example Setup

```ts
import {TestBed} from '@angular/core/testing';
import {
  NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped,
  provideRouter, Router,
} from '@angular/router';
import {filter, firstValueFrom} from 'rxjs';
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
2. **`RouterTestingHarness.create()`**: Asynchronously creates the harness. Pass an initial URL, such as `create('/')`, to navigate before it returns; without an argument, it does not trigger an initial navigation.

## Writing Router Tests

Once the harness is created, you can use it to drive navigation and make assertions on the state of the router and the activated components.

### Example: Testing Navigation

```ts
it('should navigate to a hero detail when a hero is selected', async () => {
  // 1. Navigate to the initial component and get its instance
  const dashboard = await harness.navigateByUrl('/', Dashboard);

  // Suppose the dashboard has a method to select a hero
  const heroToSelect = {id: 42, name: 'Test Hero'};
  const router = TestBed.inject(Router);
  // Subscribe before triggering navigation so its completion cannot be missed.
  const navigationFinished = firstValueFrom(
    router.events.pipe(filter(event =>
      event instanceof NavigationEnd || event instanceof NavigationCancel ||
      event instanceof NavigationError || event instanceof NavigationSkipped,
    )),
  );
  dashboard.selectHero(heroToSelect);
  const result = await navigationFinished;
  // Report an unsuccessful navigation immediately instead of waiting for a timeout.
  expect(result).toBeInstanceOf(NavigationEnd);
  await harness.fixture.whenStable();
  harness.detectChanges();

  // 2. Assert on the URL
  expect(router.url).toEqual('/heroes/42');

  // 3. Get the activated component after navigation
  const heroDetail = harness.routeDebugElement?.componentInstance as HeroDetail;
  expect(heroDetail).toBeInstanceOf(HeroDetail);

  // 4. Assert on the state of the new component
  expect(heroDetail.hero.name).toBe('Test Hero');
});

it('should get the activated component directly', async () => {
  // Navigate and get the component instance in one step
  const dashboardInstance = await harness.navigateByUrl('/', Dashboard);

  expect(dashboardInstance).toBeInstanceOf(Dashboard);
});
```

### Best Practices

- **Navigate with the Harness:** Use `harness.navigateByUrl(url, ComponentType)` for direct test navigation. It waits for navigation and returns the activated component instance. For component-triggered navigation, await its completion separately.
- **Access the Router State:** Use `TestBed.inject(Router)` to access the live router instance and assert on its URL.
- **Get Activated Components:** Use the component returned by `navigateByUrl(url, ComponentType)`, or inspect `harness.routeDebugElement?.componentInstance` after component-triggered navigation. `RouterTestingHarness` is not a CDK harness loader.
- **Wait for Navigation:** Await the navigation promise or a terminal event subscribed to before the action. Include cancellation, error, and skipped events, and assert the expected outcome. Then wait for fixture stability and run change detection before asserting on the rendered view.
