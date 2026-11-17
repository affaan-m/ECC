---
name: godot-patterns
description: Idiomatic Godot 4 GDScript patterns - static typing, scene and node design, signals, resources, autoloads, input, and lifecycle safety. Use when writing or reviewing GDScript, designing scenes, or deciding where game state should live.
origin: ECC
---

# Godot 4 GDScript Patterns

Idiomatic patterns for Godot 4.x projects written in GDScript. Verified against the Godot 4.7 documentation; most guidance applies to every 4.x release.

## When to Activate

- Writing or reviewing `.gd` files
- Designing a scene tree or deciding which node owns what
- Choosing between a signal, a direct call, an autoload, or a Resource
- Debugging "node not found", freed-object, or signal-connection errors
- Structuring a game so its logic can be tested without running the renderer

## Core Principles

1. **Type everything.** Typed GDScript catches bugs at parse time and speeds up the editor.
2. **Call down, signal up.** A parent may call methods on its children. A child announces events with signals and never reaches up to its parent.
3. **Keep game logic out of Nodes where you can.** Plain `RefCounted` or `Resource` classes can be tested headlessly. Nodes should draw and forward input.
4. **Data lives in Resources, not in scripts full of constants.**
5. **Autoloads are global state.** Use as few as you can and treat each one as a public API.

## Static Typing

```gdscript
class_name Inventory
extends RefCounted
## A bag of item counts. Pure data and rules: no Node, so tests can run headlessly.

signal item_added(item_id: StringName, new_count: int)  ## typed signal parameters

const MAX_STACK: int = 99           ## typed constant

var _counts: Dictionary[StringName, int] = {}  ## typed Dictionary (Godot 4.4+)


## Adds `amount` of an item and returns how many were actually added.
func add(item_id: StringName, amount: int) -> int:
	var current: int = _counts.get(item_id, 0)
	var added: int = mini(amount, MAX_STACK - current)   # clamp to the stack limit
	if added <= 0:
		return 0
	_counts[item_id] = current + added
	item_added.emit(item_id, _counts[item_id])           # Signal.emit(), not emit_signal()
	return added
```

Rules of thumb:

- Annotate parameters and return types (`-> void` included).
- Use `:=` when the type is obvious from the right-hand side, and an explicit type when it is not.
- Use typed arrays (`Array[Enemy]`) and, on 4.4+, typed dictionaries.
- Use `StringName` literals (`&"player"`) for ids and keys that are compared often.
- Cast with `as` and check the result for `null` before using it.

## File Layout and Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| Files and folders | `snake_case` | `player_controller.gd` |
| Classes (`class_name`) | `PascalCase` | `PlayerController` |
| Functions, variables | `snake_case` | `take_damage()` |
| Private members | leading `_` | `_speed` |
| Constants, enum values | `CONSTANT_CASE` | `MAX_LIVES` |
| Signals | past-tense `snake_case` | `health_changed` |

Order inside a script (from the official style guide): `class_name`, `extends`, doc comment, signals, enums, constants, `@export` vars, public vars, private vars, `@onready` vars, then methods. Put built-in callbacks (`_init`, `_ready`, `_process`) before your own methods.

## Scene and Node Design

### Call down, signal up

```gdscript
class_name Player
extends CharacterBody2D
## The player owns a Health child and listens to it. Health knows nothing about Player.

@onready var _health: Health = %Health        # %Name = scene-unique node, survives re-parenting


func _ready() -> void:
	# Listen UP the tree via the child's signal (child -> parent communication).
	_health.died.connect(_on_died)


func _on_died() -> void:
	queue_free()                               # parent decides what death means
```

```gdscript
class_name Health
extends Node
## A reusable component. It emits events and never touches its parent.

signal died
signal changed(current: int, maximum: int)

@export var maximum: int = 10                  # tweakable per scene in the inspector

var current: int = maximum


func damage(amount: int) -> void:
	current = maxi(current - amount, 0)
	changed.emit(current, maximum)
	if current == 0:
		died.emit()
```

### Wiring siblings without hard paths

Avoid `get_node("../../UI/Label")`. It breaks whenever the tree changes. Prefer, in order:

1. `%UniqueName` for nodes inside the same scene.
2. An `@export var target: Node` assigned in the inspector.
3. A signal that a common ancestor connects.
4. Groups (`add_to_group("enemies")`, `get_tree().get_nodes_in_group("enemies")`) for "all of a kind" queries.

## Signals

- Connect with a `Callable`: `button.pressed.connect(_on_pressed)`.
- For one-shot reactions use `CONNECT_ONE_SHOT`.
- Disconnect or `queue_free()` on teardown. A connection to a freed object is cleaned up automatically, but a long-lived emitter holding a Callable to a short-lived object that is still alive keeps it reacting.
- Bind extra arguments with `.bind()`: `slot.pressed.connect(_on_slot.bind(slot_index))`.
- Do not use signals for hot per-frame data. Read the value directly.

## Resources for Data

```gdscript
class_name WeaponData
extends Resource
## Designer-editable weapon stats stored as a .tres file. No logic beyond small helpers.

@export var display_name: String = ""
@export var damage: int = 1
@export var cooldown_seconds: float = 0.5
@export var icon: Texture2D


## Damage per second, derived so it is never stored twice and cannot drift.
func dps() -> float:
	return damage / cooldown_seconds
```

- Share one `.tres` for read-only data. Call `duplicate()` before mutating it per instance, otherwise every user of that file changes together.
- Use Resources for save data too, but never load a `.tres` or `.res` from an untrusted path: Resources can embed scripts. For user-provided saves use JSON or `ConfigFile`.

## Autoloads (Singletons)

Good uses: an event bus, settings, scene-transition manager, save system.
Bad uses: anything that holds per-level state and must reset on restart.

```gdscript
# events.gd, registered in Project Settings > Globals > Autoload as "Events"
extends Node
## A tiny global event bus. Keep it to cross-scene events only.

signal player_died
signal score_changed(new_score: int)
```

Treat each autoload name as a public API. Document it, and do not let gameplay code reach into its private fields.

## Process Callbacks and Timing

| Callback | Use for |
|----------|---------|
| `_physics_process(delta)` | Movement, physics, anything tied to the physics tick |
| `_process(delta)` | Visuals, UI, interpolation |
| `_input(event)` / `_unhandled_input(event)` | Discrete input events; prefer `_unhandled_input` for gameplay so UI can consume events first |

```gdscript
func _physics_process(delta: float) -> void:
	# Input.get_vector reads four named actions and returns a normalised 2D direction.
	var direction: Vector2 = Input.get_vector(&"move_left", &"move_right", &"move_up", &"move_down")
	velocity = direction * speed          # speed is units per second, so no delta needed here
	move_and_slide()                      # move_and_slide() applies delta internally
```

- Scale by `delta` for anything you add per frame (`position += velocity * delta`) but not for `move_and_slide()`.
- Define input as InputMap actions in Project Settings, never as hard-coded keys, so rebinding and gamepads work.
- Use `await get_tree().create_timer(1.0).timeout` for short delays. Use a `Timer` node when you need to stop or restart it.
- Turn off processing on idle nodes with `set_process(false)`.

## Lifecycle Safety

```gdscript
# BAD: the enemy may be freed before the timer fires.
await get_tree().create_timer(2.0).timeout
enemy.take_damage(5)

# GOOD: check the reference is still valid after every await.
await get_tree().create_timer(2.0).timeout
if is_instance_valid(enemy):
	enemy.take_damage(5)
```

- Use `queue_free()` instead of `free()` so the node is removed at a safe point in the frame.
- `@onready` variables are only valid after the node enters the tree. Never read them in `_init`.
- A node removed with `remove_child()` is not freed. Free it yourself or it leaks.
- `get_node()` on a missing path errors at runtime. Use `get_node_or_null()` when absence is legitimate.

## Anti-Patterns

| Anti-pattern | Why it hurts | Instead |
|--------------|--------------|---------|
| Untyped everything | Bugs surface at runtime, weak autocomplete | Annotate types |
| One 2,000-line `main.gd` | Untestable, merge conflicts | Split into components and `RefCounted` logic classes |
| Child calls `get_parent().foo()` | Hidden coupling, breaks when reused | Emit a signal |
| Deep `get_node("../../..")` paths | Breaks on any tree change | `%Unique` names, exports, groups |
| Magic numbers in scripts | Needs a code change to tune | `@export` or a `Resource` |
| Mutating a shared Resource | Changes every instance | `duplicate()` first |
| Gameplay in autoloads | Leaks state across restarts | Scene-owned nodes, reset on load |
| Hard-coded `KEY_*` checks | No rebinding or gamepad | InputMap actions |

## Related

- Skill: `godot-testing` for headless tests of the patterns above
- Agent: `gdscript-reviewer` for review checklists
- Skill: `python-patterns` for the closest typed, snake_case idioms if you are coming from Python
