---
name: rules-arkts
description: ECC arkts engineering rules for coding style, patterns, security, and testing.
display_name: "ECC Arkts Rules"
icon: book
---

# ECC Arkts Rules

## HarmonyOS / ArkTS Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with HarmonyOS and ArkTS-specific content.

### ArkTS Language Constraints

ArkTS is a strict, statically-typed subset of TypeScript. Violating these constraints causes **compilation failures**.

#### Type System

- No `any` or `unknown` types - always use explicit types
- No index access types - use type names directly
- No conditional type aliases or `infer` keyword
- No intersection types - use inheritance
- No mapped types - use classes and regular idioms
- No `typeof` for type annotations - use explicit type declarations
- No `as const` assertions - use explicit type annotations
- No structural typing - use inheritance, interfaces, or type aliases
- No TypeScript utility types except `Partial`, `Required`, `Readonly`, `Record`
- For `Record<K, V>`, index expression type is `V | undefined`
- Omit type annotations in `catch` clauses (ArkTS does not support `any`/`unknown`)

#### Functions & Classes

- No function expressions - use arrow functions
- No nested functions - use lambdas
- No generator functions - use `async`/`await` for multitasking
- No `Function.apply`, `Function.call`, `Function.bind` - follow traditional OOP for `this`
- No constructor type expressions - use lambdas
- No constructor signatures in interfaces or object types - use methods or classes
- No declaring class fields in constructors - declare in class body
- No `this` in standalone functions or static methods - only in instance methods
- No `new.target`
- No definite assignment assertions (`let v!: T`) - use initialized declarations
- No class literals - introduce named class types
- No using classes as objects (assigning to variables) - class declarations introduce types, not values
- Only one static block per class - merge all static statements

#### Object & Property Access

- No dynamic field declaration or `obj["field"]` access - use `obj.field` syntax
- No `delete` operator - use nullable type with `null` to mark absence
- No prototype assignment - use classes and interfaces
- No `in` operator - use `instanceof`
- No reassigning object methods - use wrapper functions or inheritance
- No `Symbol()` API (except `Symbol.iterator`)
- No `globalThis` or global scope - use explicit module exports/imports
- No namespaces as objects - use classes or modules
- No statements inside namespaces - use functions

#### Destructuring & Spread

- No destructuring assignments or variable declarations - use intermediate objects and field-by-field access
- No destructuring parameter declarations - pass parameters directly, assign local names manually
- Spread operator only for expanding arrays (or array-derived classes) into rest parameters or array literals

#### Modules & Imports

- No `require()` - use regular `import` syntax
- No `export = ...` - use normal export/import
- No import assertions - imports are compile-time in ArkTS
- No UMD modules
- No wildcards in module names
- All `import` statements must appear before all other statements
- TypeScript codebases must not depend on ArkTS codebases via import (reverse is supported)

#### Other Restrictions

- No `var` - use `let`
- No `for...in` loops - use regular `for` loops for arrays
- No `with` statements
- No JSX expressions
- No `#` private identifiers - use `private` keyword
- No declaration merging (classes, interfaces, enums) - keep definitions compact
- No index signatures - use arrays
- Comma operator only in `for` loops
- Unary operators `+`, `-`, `~` only for numeric types (no implicit string conversion)
- Enum members: only same-type compile-time expressions for explicit initializers
- Function return type inference is limited - specify return types explicitly when calling functions with omitted return types

#### Object Literals

- Supported only when compiler can infer the corresponding class or interface
- NOT supported for: `any`/`Object`/`object` types, classes/interfaces with methods, classes with parameterized constructors, classes with `readonly` fields

### Naming Conventions

- Variables / functions: `camelCase` (e.g., `getUserInfo`, `goodsList`)
- Classes / interfaces: `PascalCase` (e.g., `UserViewModel`, `IGoodsModel`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_PAGE_SIZE`, `COLOR_PRIMARY`)
- File names: `PascalCase` for components (e.g., `HomePage.ets`), `camelCase` for utilities

### Formatting

- Prefer double quotes for strings
- Semicolons at end of statements
- Never use `var` - prefer `const`, then `let`
- All methods, parameters, return values must have complete type annotations

### File Organization

- Component files (`.ets`): one `@ComponentV2` per file
- ViewModel files: one ViewModel class per file
- Model files: related data models may share a file
- Keep files under 400 lines; extract helpers for files approaching 800 lines

### Comments

- File header: `@file` (file purpose) + `@author` (developer), if the project already uses file headers
- Public methods: JSDoc with `@param`, `@returns`; add `@example` for complex methods
- Match the project's existing documentation language; use English unless the repository has already standardized on Chinese comments

### Error Handling

```typescript
// Use try/catch with proper error handling
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  hilog.error(0x0000, 'TAG', 'Operation failed: %{public}s', error)
  throw new Error('User-friendly error message')
}
```

### Immutability

Follow the common immutability principles - create new objects instead of mutating:

```typescript
// BAD: mutation
function updateUser(user: UserModel, name: string): UserModel {
  user.name = name  // direct mutation
  return user
}

// GOOD: immutable - create new instance
function updateUser(user: UserModel, name: string): UserModel {
  const updated = new UserModel()
  updated.id = user.id
  updated.name = name
  updated.email = user.email
  return updated
}
```

## HarmonyOS / ArkTS Hooks

> This file extends [common/hooks.md](../common/hooks.md) with HarmonyOS-specific build and validation hooks.

### Build Commands

#### HAP Package Build

```bash
# Build HAP package (global hvigor environment)
hvigorw assembleHap -p product=default

# Build with specific module
hvigorw assembleHap -p module=entry -p product=default

# Clean build
hvigorw clean
```

#### DevEco Studio CLI

```bash
# Check project structure
hvigorw --version

# Install dependencies
ohpm install

# Update dependencies
ohpm update
```

### Recommended PostToolUse Hooks

#### After Editing .ets/.ts Files

Run hvigor build to check for ArkTS compilation errors:

```json
{
  "type": "PostToolUse",
  "matcher": {
    "tool": ["Edit", "Write"],
    "filePath": ["**/*.ets", "**/*.ts"]
  },
  "hooks": [
    {
      "command": "hvigorw assembleHap -p product=default 2>&1 | tail -20",
      "async": true,
      "timeout": 60000
    }
  ]
}
```

#### After Editing module.json5

Validate permission and ability declarations:

```json
{
  "type": "PostToolUse",
  "matcher": {
    "tool": "Edit",
    "filePath": "**/module.json5"
  },
  "hooks": [
    {
      "command": "echo '[HarmonyOS] module.json5 modified - verify permissions and abilities'",
      "async": false
    }
  ]
}
```

#### After Editing oh-package.json5

Reinstall dependencies:

```json
{
  "type": "PostToolUse",
  "matcher": {
    "tool": "Edit",
    "filePath": "**/oh-package.json5"
  },
  "hooks": [
    {
      "command": "ohpm install 2>&1 | tail -10",
      "async": true,
      "timeout": 30000
    }
  ]
}
```

### PreToolUse Hooks

#### V1 Decorator Guard

Warn when code contains V1 state management decorators:

```json
{
  "type": "PreToolUse",
  "matcher": {
    "tool": ["Write", "Edit"],
    "filePath": "**/*.ets"
  },
  "hooks": [
    {
      "command": "echo '[HarmonyOS] Reminder: Use @ComponentV2 / @Local / @Param - V1 decorators (@State, @Prop, @Link) are prohibited'"
    }
  ]
}
```

### Validation Checklist

After each implementation cycle, verify:

- [ ] `hvigorw assembleHap` completes without errors
- [ ] No V1 decorators in new or modified `.ets` files
- [ ] No `@ohos.router` imports in new or modified files
- [ ] All API permissions declared in `module.json5`
- [ ] All dependencies listed in `oh-package.json5`
- [ ] Resource strings added to all i18n directories
- [ ] Dark theme colors provided for new color resources

## HarmonyOS / ArkTS Patterns

> This file extends [common/patterns.md](../common/patterns.md) with HarmonyOS and ArkTS-specific patterns.

### State Management: V2 Only

**MUST use** ArkUI State Management V2. V1 decorators are deprecated and must not be used.

#### V2 Decorators

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

#### Prohibited V1 Decorators

Never use: `@State`, `@Prop`, `@Link`, `@ObjectLink`, `@Observed`, `@Provide`, `@Consume`, `@Watch`, `@Component` (use `@ComponentV2` instead).

#### V2 Component Example

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

#### State Synchronization

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

### Routing: Navigation Only

**MUST use** `Navigation` component with `NavPathStack`. Never use `@ohos.router`.

#### Navigation Setup

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

#### Page Navigation

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

#### NavDestination Sub-page

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

### Architecture Pattern: MVVM

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

### ArkUI Animation Patterns

#### State-Driven Animation

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

#### Animation Rules

- Prefer native HarmonyOS animation APIs and advanced templates
- Use declarative UI with state-driven animations (change state variables to trigger animations)
- Set `renderGroup(true)` for complex sub-component animations to reduce render batches
- **NEVER** frequently change `width`, `height`, `padding`, `margin` during animations - severe performance impact
- Use `animateTo` for explicit animation control
- Prefer `transform` (translate, scale, rotate) and `opacity` for performant animations

### Performance Patterns

#### LazyForEach for Large Lists

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

#### Component Reuse

- Extract reusable components into separate files
- Use `@Builder` for lightweight UI fragments within a component
- Use `@Param` for configurable components

### Resource References

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

## HarmonyOS / ArkTS Security

> This file extends [common/security.md](../common/security.md) with HarmonyOS-specific security practices.

### Permission Management

#### Declare Permissions in module.json5

All system API calls requiring permissions must be declared:

```json5
{
  "module": {
    "requestPermissions": [
      {
        "name": "ohos.permission.INTERNET",
        "reason": "$string:internet_permission_reason",
        "usedScene": {
          "abilities": ["EntryAbility"],
          "when": "always"
        }
      }
    ]
  }
}
```

#### Permission Checklist

Before calling system APIs, verify:

- [ ] Permission declared in `module.json5`
- [ ] Permission reason string defined in resources (for user-facing permissions)
- [ ] Runtime permission request implemented for sensitive permissions (camera, location, etc.)
- [ ] Permission check before API call with graceful fallback on denial

#### Runtime Permission Request

```typescript
import { abilityAccessCtrl, bundleManager, Permissions } from '@kit.AbilityKit';

async function checkAndRequestPermission(permission: Permissions): Promise<boolean> {
  const atManager = abilityAccessCtrl.createAtManager();
  const bundleInfo = await bundleManager.getBundleInfoForSelf(
    bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION
  );
  const tokenId = bundleInfo.appInfo.accessTokenId;
  const grantStatus = await atManager.checkAccessToken(tokenId, permission);

  if (grantStatus === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
    return true;
  }

  const result = await atManager.requestPermissionsFromUser(getContext(), [permission]);
  return result.authResults[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
}
```

### Secret Management

- **NEVER** hardcode API keys, tokens, or passwords in `.ets`/`.ts` source files
- Use HarmonyOS Preferences API for non-sensitive configuration
- Use HarmonyOS Keystore for sensitive credentials
- Environment-specific configs should be managed via build profiles

```typescript
// BAD: hardcoded secret
const API_KEY: string = 'sk-xxxxxxxxxxxx';

// GOOD: from build profile config (non-sensitive)
import { BuildProfile } from 'BuildProfile';
const endpoint = BuildProfile.API_ENDPOINT;

// GOOD: use HUKS to encrypt/decrypt data without exposing key material
import { huks } from '@kit.UniversalKeystoreKit';
async function decryptWithKeystore(alias: string, nonce: Uint8Array, aad: Uint8Array, cipherData: Uint8Array): Promise<Uint8Array> {
  const options: huks.HuksOptions = {
    properties: [
      { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
      { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT },
      { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM },
      { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
      { tag: huks.HuksTag.HUKS_TAG_NONCE, value: nonce },
      { tag: huks.HuksTag.HUKS_TAG_ASSOCIATED_DATA, value: aad }
    ],
    inData: cipherData
  };
  const handle = await huks.initSession(alias, options);
  const result = await huks.finishSession(handle.handle, options);
  return result.outData;
}
```

### Input Validation

- Validate all user input before processing
- Sanitize data before displaying in UI to prevent injection
- Validate deep link parameters before navigation

```typescript
// Validate before navigation
function handleDeepLink(uri: string): void {
  const allowedPaths: string[] = ['detail', 'settings', 'profile'];
  const parsed = new URL(uri);
  const path = parsed.pathname.replace('/', '');

  if (!allowedPaths.includes(path)) {
    hilog.warn(0x0000, 'DeepLink', 'Invalid deep link path: %{public}s', path);
    return;
  }

  navPathStack.pushPath({ name: path });
}
```

### Network Security

- Always use HTTPS for network requests
- Validate server certificates
- Implement request timeout and retry policies
- Never log sensitive data (tokens, user credentials) in network request/response logs

### Data Storage Security

- Use encrypted preferences for sensitive local data
- Clear sensitive data from memory when no longer needed
- Implement proper data lifecycle management
- Consider data classification (public, internal, confidential) when choosing storage mechanisms

### Dependency Security

- Only use dependencies from trusted sources (official ohpm registry)
- Verify dependency versions in `oh-package.json5`
- Regularly check for known vulnerabilities in third-party libraries
- Pin dependency versions to avoid unexpected updates

## HarmonyOS / ArkTS Testing

> This file extends [common/testing.md](../common/testing.md) with HarmonyOS-specific testing practices.

### Test Framework

HarmonyOS uses the built-in test framework with `@ohos.test` capabilities:

- **Unit tests**: Located in `src/ohosTest/ets/test/`
- **UI tests**: Use `@ohos.UiTest` for component testing
- **Instrument tests**: Run on device/emulator

### Test Directory Structure

```
module/
  |-- src/
  |   |-- main/ets/          # Production code
  |   |-- ohosTest/ets/      # Test code
  |       |-- test/
  |       |   |-- Ability.test.ets
  |       |   |-- List.test.ets
  |       |-- TestAbility.ets
  |       |-- TestRunner.ets
```

### Running Tests

```bash
# Run all tests for a module
hvigorw testHap -p product=default

# Run tests on connected device
hdc shell aa test -b com.example.app -m entry_test -s unittest /ets/TestRunner/OpenHarmonyTestRunner
```

### Unit Test Example

```typescript
import { describe, it, expect } from '@ohos/hypium';

export default function UserViewModelTest() {
  describe('UserViewModel', () => {
    it('should_initialize_with_empty_state', 0, () => {
      const vm = new UserViewModel();
      expect(vm.userName).assertEqual('');
      expect(vm.isLoading).assertFalse();
    });

    it('should_update_user_name', 0, () => {
      const vm = new UserViewModel();
      vm.updateUserName('Alice');
      expect(vm.userName).assertEqual('Alice');
    });

    it('should_handle_empty_input', 0, () => {
      const vm = new UserViewModel();
      vm.updateUserName('');
      expect(vm.userName).assertEqual('');
      expect(vm.hasError).assertFalse();
    });
  });
}
```

### UI Test Example

```typescript
import { describe, it, expect } from '@ohos/hypium';
import { Driver, ON } from '@ohos.UiTest';

export default function HomePageUITest() {
  describe('HomePage_UI', () => {
    it('should_display_title', 0, async () => {
      const driver = Driver.create();
      await driver.delayMs(1000);

      const title = await driver.findComponent(ON.text('Home'));
      expect(title !== null).assertTrue();
    });

    it('should_navigate_to_detail_on_click', 0, async () => {
      const driver = Driver.create();
      const button = await driver.findComponent(ON.id('detailButton'));
      await button.click();
      await driver.delayMs(500);

      const detailTitle = await driver.findComponent(ON.text('Detail'));
      expect(detailTitle !== null).assertTrue();
    });
  });
}
```

### TDD Workflow for HarmonyOS

Follow the standard TDD cycle adapted for HarmonyOS:

1. **RED**: Write a failing test in `ohosTest/ets/test/`
2. **GREEN**: Implement minimal code in `main/ets/` to pass
3. **REFACTOR**: Clean up while keeping tests green
4. **BUILD**: Run `hvigorw assembleHap` to verify compilation
5. **VERIFY**: Run tests on device/emulator

### Test Coverage Requirements

- Minimum 80% coverage for all critical application code (ViewModels, services, utilities)
- **Unit tests**: All utility functions, ViewModel logic, data models
- **Integration tests**: API calls, database operations, cross-module interactions
- **E2E / UI tests**: Critical user flows (login, navigation, data submission)
- Test edge cases: empty data, network errors, permission denials

### Testing Best Practices

- Keep tests independent - no shared mutable state between tests
- Mock network calls and system APIs in unit tests
- Use meaningful test names: `should_[expected_behavior]_when_[condition]`
- Test V2 state management reactivity: verify `@Trace` properties trigger UI updates
- Test Navigation flows: verify `NavPathStack` push/pop/replace operations
- Avoid testing framework internals - focus on business logic and user-visible behavior
