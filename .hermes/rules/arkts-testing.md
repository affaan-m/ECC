---
paths:
  - "**/*.ets"
  - "**/*.ts"
  - "**/ohosTest/**"
---
# HarmonyOS / ArkTS Testing

> This file extends [common/testing.md](../common/testing.md) with HarmonyOS-specific testing practices.

## Test Framework

HarmonyOS uses the built-in test framework with `@ohos.test` capabilities:

- **Unit tests**: Located in `src/ohosTest/ets/test/`
- **UI tests**: Use `@ohos.UiTest` for component testing
- **Instrument tests**: Run on device/emulator

## Test Directory Structure

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

## Running Tests

```bash
# Run all tests for a module
hvigorw testHap -p product=default

# Run tests on connected device
hdc shell aa test -b com.example.app -m entry_test -s unittest /ets/TestRunner/OpenHarmonyTestRunner
```

## Unit Test Example

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

## UI Test Example

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

## TDD Workflow for HarmonyOS

Follow the standard TDD cycle adapted for HarmonyOS:

1. **RED**: Write a failing test in `ohosTest/ets/test/`
2. **GREEN**: Implement minimal code in `main/ets/` to pass
3. **REFACTOR**: Clean up while keeping tests green
4. **BUILD**: Run `hvigorw assembleHap` to verify compilation
5. **VERIFY**: Run tests on device/emulator

## Test Coverage Requirements

- Minimum 80% coverage for all critical application code (ViewModels, services, utilities)
- **Unit tests**: All utility functions, ViewModel logic, data models
- **Integration tests**: API calls, database operations, cross-module interactions
- **E2E / UI tests**: Critical user flows (login, navigation, data submission)
- Test edge cases: empty data, network errors, permission denials

## Testing Best Practices

- Keep tests independent - no shared mutable state between tests
- Mock network calls and system APIs in unit tests
- Use meaningful test names: `should_[expected_behavior]_when_[condition]`
- Test V2 state management reactivity: verify `@Trace` properties trigger UI updates
- Test Navigation flows: verify `NavPathStack` push/pop/replace operations
- Avoid testing framework internals - focus on business logic and user-visible behavior
