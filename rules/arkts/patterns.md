---
paths:
  - "**/*.ets"
  - "**/*.ts"
---
# HarmonyOS / ArkTS Patterns

> This file extends [common/patterns.md](../common/patterns.md) with HarmonyOS and ArkTS-specific patterns.

## State Management: V2 Only

**MUST use** ArkUI State Management V2. V1 decorators are deprecated and must not be used.

### V2 Decorators

| Decorator | Purpose |
|-----------|---------|
| `@ComponentV2` | Marks a struct as a V2 component |
| `@Local` | Local state within a component |
| `@Param` | Props received from parent (read-only) |
| `@Event` | Callback events from child to parent |
| `@Provider` | Provides state to descendant components |
| `@Consumer` | Consumes state from ancestor `@Provider` |
| `@Monitor` | Watches for state changes (replaces V1 `@Watch`) |
| `@Computed` | Derived/computed values |
| `@ObservedV2` | Makes a class observable for V2 state management |
| `@Trace` | Marks observable properties in `@ObservedV2` classes |

### Prohibited V1 Decorators

Never use: `@State`, `@Prop`, `@Link`, `@ObjectLink`, `@Observed`, `@Provide`, `@Consume`, `@Watch`, `@Component` (use `@ComponentV2` instead).

### V2 Component Example

```typescript
@ObservedV2
class UserModel {
  @Trace name: string = ''
  @Trace age: number = 0
}

@ComponentV2
struct UserCard {
  @Param user: UserModel = new UserModel()
  @Event onDelete: () => void = () => {}

  build() {
    Column() {
      Text(this.user.name)
        .fontSize($r('app.float.font_size_title'))
      Text(`${this.user.age}`)
        .fontSize($r('app.float.font_size_body'))
      Button($r('app.string.delete'))
        .onClick(() => this.onDelete())
    }
  }
}
```

### State Synchronization

```typescript
@ComponentV2
struct ParentPage {
  @Provider('userState') userModel: UserModel = new UserModel()

  build() {
    Column() {
      ChildComponent()  // automatically receives @Consumer('userState')
    }
  }
}

@ComponentV2
struct ChildComponent {
  @Consumer('userState') userModel: UserModel = new UserModel()

  build() {
    Text(this.userModel.name)
  }
}
```

## Routing: Navigation Only

**MUST use** `Navigation` component with `NavPathStack`. Never use `@ohos.router`.

### Navigation Setup

```typescript
@ComponentV2
struct MainPage {
  @Local navPathStack: NavPathStack = new NavPathStack()

  build() {
    Navigation(this.navPathStack) {
      // Home content
    }
    .navDestination(this.routerMap)
  }

  @Builder
  routerMap(name: string, param: ESObject) {
    if (name === 'detail') {
      DetailPage()
    } else if (name === 'settings') {
      SettingsPage()
    }
  }
}
```

### Page Navigation

```typescript
// Push a new page
this.navPathStack.pushPath({ name: 'detail', param: { id: '123' } })

// Replace current page
this.navPathStack.replacePath({ name: 'settings' })

// Pop back
this.navPathStack.pop()

// Pop to root
this.navPathStack.clear()
```

### NavDestination Sub-page

```typescript
@ComponentV2
struct DetailPage {
  build() {
    NavDestination() {
      Column() {
        Text($r('app.string.detail_title'))
      }
    }
    .title($r('app.string.detail_nav_title'))
  }
}
```

## Architecture Pattern: MVVM

Recommended architecture for HarmonyOS applications:

```
feature/
  |-- model/           # Data models (@ObservedV2 classes)
  |-- viewmodel/       # Business logic (ViewModel classes)
  |-- view/            # UI components (@ComponentV2 structs)
  |-- service/         # API calls, data access
```

- **View**: Only rendering logic, no business logic in `build()`
- **ViewModel**: All business logic encapsulated here
- **Model**: Pure data classes with `@ObservedV2` and `@Trace`
- **Service**: Network requests, database operations, file I/O

## ArkUI Animation Patterns

### State-Driven Animation

```typescript
@ComponentV2
struct AnimatedCard {
  @Local isExpanded: boolean = false
  @Local cardScale: number = 0.8

  build() {
    Column() {
      // Content
    }
    .scale({ x: this.cardScale, y: this.cardScale })
    .animation({ duration: 300, curve: Curve.EaseInOut })
    .onClick(() => {
      this.isExpanded = !this.isExpanded
      this.cardScale = this.isExpanded ? 1.0 : 0.8
    })
  }
}
```

### Animation Rules

- Prefer native HarmonyOS animation APIs and advanced templates
- Use declarative UI with state-driven animations (change state variables to trigger animations)
- Set `renderGroup(true)` for complex sub-component animations to reduce render batches
- **NEVER** frequently change `width`, `height`, `padding`, `margin` during animations - severe performance impact
- Use `animateTo` for explicit animation control
- Prefer `transform` (translate, scale, rotate) and `opacity` for performant animations

## Performance Patterns

### LazyForEach for Large Lists

```typescript
@ComponentV2
struct LargeList {
  @Local dataSource: MyDataSource = new MyDataSource()

  build() {
    List() {
      LazyForEach(this.dataSource, (item: ItemModel) => {
        ListItem() {
          ItemComponent({ item: item })
        }
      }, (item: ItemModel) => item.id)
    }
  }
}
```

### Component Reuse

- Extract reusable components into separate files
- Use `@Builder` for lightweight UI fragments within a component
- Use `@Param` for configurable components

## Resource References

Always define UI constants as resources and reference via `$r()`:

```typescript
// BAD: hardcoded values
Text('Hello')
  .fontSize(16)
  .fontColor('#333333')

// GOOD: resource references
Text($r('app.string.greeting'))
  .fontSize($r('app.float.font_size_body'))
  .fontColor($r('app.color.text_primary'))
```
