---
paths:
  - "**/*.ets"
  - "**/*.ts"
  - "**/module.json5"
  - "**/oh-package.json5"
  - "**/build-profile.json5"
---
# HarmonyOS / ArkTS Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with HarmonyOS and ArkTS-specific content.

## ArkTS Language Constraints

ArkTS is a strict, statically-typed subset of TypeScript. Violating these constraints causes **compilation failures**.

### Type System

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

### Functions & Classes

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

### Object & Property Access

- No dynamic field declaration or `obj["field"]` access - use `obj.field` syntax
- No `delete` operator - use nullable type with `null` to mark absence
- No prototype assignment - use classes and interfaces
- No `in` operator - use `instanceof`
- No reassigning object methods - use wrapper functions or inheritance
- No `Symbol()` API (except `Symbol.iterator`)
- No `globalThis` or global scope - use explicit module exports/imports
- No namespaces as objects - use classes or modules
- No statements inside namespaces - use functions

### Destructuring & Spread

- No destructuring assignments or variable declarations - use intermediate objects and field-by-field access
- No destructuring parameter declarations - pass parameters directly, assign local names manually
- Spread operator only for expanding arrays (or array-derived classes) into rest parameters or array literals

### Modules & Imports

- No `require()` - use regular `import` syntax
- No `export = ...` - use normal export/import
- No import assertions - imports are compile-time in ArkTS
- No UMD modules
- No wildcards in module names
- All `import` statements must appear before all other statements
- TypeScript codebases must not depend on ArkTS codebases via import (reverse is supported)

### Other Restrictions

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

### Object Literals

- Supported only when compiler can infer the corresponding class or interface
- NOT supported for: `any`/`Object`/`object` types, classes/interfaces with methods, classes with parameterized constructors, classes with `readonly` fields

## Naming Conventions

- Variables / functions: `camelCase` (e.g., `getUserInfo`, `goodsList`)
- Classes / interfaces: `PascalCase` (e.g., `UserViewModel`, `IGoodsModel`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_PAGE_SIZE`, `COLOR_PRIMARY`)
- File names: `PascalCase` for components (e.g., `HomePage.ets`), `camelCase` for utilities

## Formatting

- Prefer double quotes for strings
- Semicolons at end of statements
- Never use `var` - prefer `const`, then `let`
- All methods, parameters, return values must have complete type annotations

## File Organization

- Component files (`.ets`): one `@ComponentV2` per file
- ViewModel files: one ViewModel class per file
- Model files: related data models may share a file
- Keep files under 400 lines; extract helpers for files approaching 800 lines

## Comments

- File header: `@file` (file purpose) + `@author` (developer), if the project already uses file headers
- Public methods: JSDoc with `@param`, `@returns`; add `@example` for complex methods
- Match the project's existing documentation language; use English unless the repository has already standardized on Chinese comments

## Error Handling

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

## Immutability

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
