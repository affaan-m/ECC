# Dependency Injection (DI) Fundamentals

Dependency Injection (DI) is a design pattern used to organize and share code across an application by allowing you to "inject" features into different parts. This improves code maintainability, scalability, and testability.

## How DI Works in Angular

There are two primary ways code interacts with Angular's DI system:

1. **Providing**: Making values (objects, functions, primitives) available to the DI system.
2. **Injecting**: Asking the DI system for those values.

Angular components, directives, and services automatically participate in DI.

## Services

A **service** is the most common way to share data and functionality across an application. It is a TypeScript class decorated with `@Injectable()`.

### Creating a Service

Use the `providedIn: 'root'` option in the `@Injectable` decorator to make the service a singleton available throughout the entire application. This is the recommended approach for most services.

```ts
import {Injectable} from '@angular/core';

@Injectable({
  providedIn: 'root', // Makes this a singleton available everywhere
})
export class AnalyticsLogger {
  trackEvent(category: string, value: string) {
    console.log('Analytics event logged:', {category, value});
  }
}
```

Common uses for services include:

- Data clients (API calls)
- State management
- Authentication and authorization
- Logging and error handling
- Utility functions

## Injecting Dependencies

Use Angular's `inject()` function to request dependencies.

### The `inject()` Function

You can use the `inject()` function to get an instance of a service (or any other provided token).

```ts
import {Component, inject} from '@angular/core';
import {Router} from '@angular/router';
import {AnalyticsLogger} from './analytics-logger.service';

@Component({
  selector: 'app-navbar',
  template: `<a href="#" (click)="navigateToDetail($event)">Detail Page</a>`,
})
export class Navbar {
  // Injecting dependencies using class field initializers
  private router = inject(Router);
  private analytics = inject(AnalyticsLogger);

  navigateToDetail(event: Event) {
    event.preventDefault();
    this.analytics.trackEvent('navigation', '/details');
    this.router.navigate(['/details']);
  }
}
```

### Where can `inject()` be used? (Injection Context)

You can call `inject()` in an **injection context**. The most common injection contexts are during the construction of a component, directive, or service.

Valid places to call `inject()`:

1. **Class field initializers** (Recommended)
2. **Constructor body**
3. **Route guards and resolvers** (which are executed in an injection context)
4. **Factory functions** used in providers

```typescript
import {Component, Directive, Injectable, inject, ElementRef} from '@angular/core';
import {HttpClient} from '@angular/common/http';

// 1. In a Component (Field Initializer & Constructor)
@Component({
  /*...*/
})
export class Example {
  private service1 = inject(MyService); // Valid field initializer

  private service2: MyService;
  constructor() {
    this.service2 = inject(MyService); // Valid constructor body
  }
}

// 2. In a Directive
@Directive({
  /*...*/
})
export class MyDirective {
  private element = inject(ElementRef); // Valid field initializer
}

// 3. In a Service
@Injectable({providedIn: 'root'})
export class MyService {
  private http = inject(HttpClient); // Valid field initializer
}

// 4. In a Route Guard (Functional)
export const authGuard = () => {
  const auth = inject(AuthService); // Valid route guard
  return auth.isAuthenticated();
};
```
