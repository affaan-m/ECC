# Angular Animations

When animating elements in Angular, **first analyze the project's Angular version** in `package.json`.
For modern applications (**Angular v20.2 and above**), prefer using native CSS with `animate.enter` and `animate.leave`. For older applications, you may need to use the deprecated `@angular/animations` package.

## 1. Native CSS Animations (v20.2+ Recommended)

Modern Angular provides `animate.enter` and `animate.leave` to animate elements as they enter or leave the DOM. They apply CSS classes at the appropriate times.

### `animate.enter` and `animate.leave`

Use these directly on elements to apply CSS classes during the enter or leave phase. Angular automatically removes the enter classes when the animation completes. For `animate.leave`, Angular waits for the animation to finish before removing the element from the DOM.

`animate.enter` example:

```html
@if (isShown()) {
<div class="enter-container" animate.enter="enter-animation">
  <p>The box is entering.</p>
</div>
}
```

```css
/* Ensure you have a starting style if using transitions instead of keyframes */
.enter-container {
  border: 1px solid #dddddd;
  margin-top: 1em;
  padding: 20px;
  font-weight: bold;
  font-size: 20px;
}
.enter-container p {
  margin: 0;
}
.enter-animation {
  animation: slide-fade 1s;
}
@keyframes slide-fade {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

_Note: `animate.leave` may be added to child elements being removed._

### Event Bindings and Third-party Libraries

You can bind to `(animate.enter)` and `(animate.leave)` to call functions or use JS libraries like GSAP.

```html
@if(show()) {
<div (animate.leave)="onLeave($event)">...</div>
}
```

```ts
import { AnimationCallbackEvent } from '@angular/core';

onLeave(event: AnimationCallbackEvent) {
  // Custom animation logic here
  // CRITICAL: You MUST call animationComplete() when done so Angular removes the element!
  event.animationComplete();
}
```

## 2. Advanced CSS Animations

CSS offers robust tools for advanced animation sequences.

### Animating State and Styles

Toggle CSS classes on elements using property binding to trigger transitions.

```html
<div [class.open]="isOpen">...</div>
```

```css
div {
  transition: height 0.3s ease-out;
  height: 100px;
}
div.open {
  height: 200px;
}
```

### Animating Auto Height

You can use `css-grid` to animate to auto height.

```css
.container {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s;
}
.container.open {
  grid-template-rows: 1fr;
}
.container > div {
  overflow: hidden;
}
```

### Staggering and Parallel Animations

- **Staggering**: Use `animation-delay` or `transition-delay` with different values for items in a list.
- **Parallel**: Apply multiple animations in the `animation` shorthand (e.g., `animation: rotate 3s, fade-in 2s;`).

### Programmatic Control

Retrieve animations directly using standard Web APIs:

```ts
const animations = element.getAnimations();
animations.forEach((anim) => anim.pause());
```

## 3. Legacy Animations DSL (Deprecated)

For older projects (pre v20.2 or where `@angular/animations` is already heavily used), you use the component metadata DSL.

**Important:** Do not mix legacy animations and `animate.enter`/`leave` in the same component.

### Setup

```ts
bootstrapApplication(App, {
  providers: [provideAnimationsAsync()],
});
```

### Defining Transitions

```ts
import {signal} from '@angular/core';
import {trigger, state, style, animate, transition} from '@angular/animations';

@Component({
  animations: [
    trigger('openClose', [
      state('open', style({opacity: 1})),
      state('closed', style({opacity: 0})),
      transition('open <=> closed', [animate('0.5s')]),
    ]),
  ],
  template: `<div [@openClose]="isOpen() ? 'open' : 'closed'">...</div>`,
})
export class OpenClose {
  isOpen = signal(true);
}
```
