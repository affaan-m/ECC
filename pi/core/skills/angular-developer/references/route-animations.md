# Route Transition Animations

Angular Router supports the browser's **View Transitions API** for smooth visual transitions between routes.

## Enabling View Transitions

Add `withViewTransitions()` to your router configuration.

```ts
provideRouter(routes, withViewTransitions());
```

This is a **progressive enhancement**. In browsers that don't support the API, the router will still work but without the transition animation.

## How it Works

1. Browser takes a screenshot of the old state.
2. Router updates the DOM (activates new component).
3. Browser takes a screenshot of the new state.
4. Browser animates between the two states.

## Customizing with CSS

Transitions are customized in **global CSS files** (not component-scoped CSS).

Use the `::view-transition-old()` and `::view-transition-new()` pseudo-elements.

```css
/* Example: Cross-fade + Slide */
::view-transition-old(root) {
  animation: 90ms cubic-bezier(0.4, 0, 1, 1) both fade-out;
}
::view-transition-new(root) {
  animation: 210ms cubic-bezier(0, 0, 0.2, 1) 90ms both fade-in;
}
```

## Advanced Control

Use `onViewTransitionCreated` to skip transitions or customize behavior based on the navigation context.

```ts
withViewTransitions({
  onViewTransitionCreated: ({transition, from, to}) => {
    // Skip animation for specific routes
    if (to.url === '/no-animation') {
      transition.skipTransition();
    }
  },
});
```

## Best Practices

- **Global Styles**: Always define transition animations in `styles.css` to avoid view encapsulation issues.
- **View Transition Names**: Assign unique `view-transition-name` to elements that should transition smoothly across routes (e.g., a header image).
