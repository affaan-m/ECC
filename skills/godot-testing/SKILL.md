---
name: godot-testing
description: Testing Godot 4 GDScript projects - a zero-dependency headless check scene, gdUnit4 and GUT suites, scene-runner tests, signal assertions, and CI commands. Use when adding tests to a Godot project, setting up CI, or proving a change did not break the game.
origin: ECC
---

# Godot 4 Testing

A layered way to test GDScript games so most checks run headlessly in seconds, with no window and no human.

## When to Activate

- Adding the first tests to a Godot project
- Writing or reviewing gdUnit4 or GUT suites
- Setting up a headless run for CI or a pre-commit check
- Asking "does this still run?" before handing a build to a playtester

## The Test Pyramid for Games

| Layer | What it checks | Needs a window? | Speed |
|-------|---------------|-----------------|-------|
| 1. Logic tests | Pure rules in `RefCounted` or `Resource` classes (damage maths, inventory, crafting) | No | Milliseconds |
| 2. Scene tests | A scene loads, nodes wire up, signals fire, a few frames run | No (usually) | Seconds |
| 3. Playtest | Feel, balance, fun | Yes, human | Minutes |

Write most tests at layer 1. That works only if game rules live outside Nodes. See `godot-patterns`.

## Option A: Zero-Dependency Check Scene

No addon needed. A scene with a script runs checks and sets the process exit code, so a shell or CI job can fail on it.

```gdscript
# tests/verify_logic.gd, attached to the root Node of tests/verify_logic.tscn
extends Node
## A tiny headless test runner. Run it with:
##   godot --headless --path . res://tests/verify_logic.tscn

var _passed: int = 0
var _failed: int = 0


func _ready() -> void:
	# Each _test_* function is one group of related checks.
	_test_inventory_clamps_to_stack()
	_test_health_never_negative()

	print("%d passed, %d failed" % [_passed, _failed])
	# A non-zero exit code is what tells CI the run failed.
	get_tree().quit(1 if _failed > 0 else 0)


## Records one assertion and prints a line only when it fails.
func _check(condition: bool, message: String) -> void:
	if condition:
		_passed += 1
	else:
		_failed += 1
		push_error("FAIL: " + message)   # push_error also shows in the debugger


func _test_inventory_clamps_to_stack() -> void:
	var inv := Inventory.new()
	var added: int = inv.add(&"wood", 150)
	_check(added == Inventory.MAX_STACK, "add() clamps to MAX_STACK")
	_check(inv.add(&"wood", 1) == 0, "a full stack accepts nothing more")


func _test_health_never_negative() -> void:
	var health := Health.new()          # a Node, so we free it ourselves at the end
	health.damage(health.maximum + 50)
	_check(health.current == 0, "health floors at zero")
	health.free()
```

Why a scene and not `godot -s script.gd`: a scene run loads your autoloads normally, so code that references them works. Scripts started with `--script` run as the main loop, and autoload names can fail to resolve there.

Strengths: no install, tiny, easy to read. Limits: no test discovery, mocking, or nice reports. Move to Option B when this feels cramped.

## Option B: gdUnit4

Embedded framework with fluent assertions, mocks, a scene runner, and a command-line runner. Install it from the Godot Asset Library or from its GitHub repository into `addons/gdUnit4`, then enable it in Project Settings > Plugins.

### A suite

```gdscript
# tests/test_inventory.gd
extends GdUnitTestSuite
## gdUnit4 finds methods whose names start with test_.


func test_add_clamps_to_stack() -> void:
	var inv := Inventory.new()
	var added: int = inv.add(&"wood", 150)
	# Fluent assertion: assert_int(actual).is_equal(expected)
	assert_int(added).is_equal(Inventory.MAX_STACK)


func test_add_emits_signal() -> void:
	var inv := Inventory.new()
	# monitor_signals lets us ask later whether a signal fired.
	var monitor := monitor_signals(inv)
	inv.add(&"wood", 5)
	await assert_signal(inv).is_emitted("item_added", &"wood", 5)
```

### Fixtures and cleanup

- `before()` / `after()` run once per suite. `before_test()` / `after_test()` run around each test.
- Wrap anything you create in `auto_free(...)` so gdUnit4 frees it after the test and you leak nothing.
- Use `add_child(auto_free(node))` when the node must be inside the tree.

### Scene runner (layer 2)

```gdscript
func test_player_moves_right() -> void:
	# scene_runner loads the scene and lets us drive it like a player would.
	var runner := scene_runner("res://scenes/main.tscn")
	runner.simulate_action_pressed(&"move_right")   # uses InputMap action names
	await runner.simulate_frames(30)                # let 30 frames pass
	var player := runner.find_child("Player") as Node2D
	assert_object(player).is_not_null()
	assert_float(player.position.x).is_greater(0.0)
```

### Mocks

```gdscript
func test_with_mock() -> void:
	var mock_node := mock(Node)     # a stand-in with the real method names
	mock_node.get_name()
	verify(mock_node).get_name()    # asserts it was called exactly once
```

Mock collaborators you do not own (a network client, a save system). Do not mock the class under test.

### Running from the command line

```powershell
# Run every suite in tests/. Replace the path with your Godot executable if it is not on PATH.
godot --path . -s -d --remote-debug tcp://127.0.0.1:0 res://addons/gdUnit4/bin/GdUnitCmdTool.gd -a res://tests
```

- `-a <dir or file>` adds tests to run. `-i <suite>` ignores one. `-c` keeps going after a failure (the default is to stop at the first failure).
- gdUnit4's CI runner refuses to run in headless mode by default, because simulated input events do not work headless. If your suites do not depend on input, add `--ignoreHeadlessMode`. Suites that call `simulate_*` need a display or a virtual one (for example `xvfb` on Linux CI).
- The addon ships `runtest.sh` and a Windows equivalent that wrap this command. Check the version you installed.

## Option C: GUT

GUT (Godot Unit Test) is the other widely used addon.

```gdscript
# test/unit/test_health.gd
extends GutTest   # GUT discovers methods starting with test_


func test_health_floors_at_zero() -> void:
	var health := autofree(Health.new())    # autofree = freed after the test
	health.damage(999)
	assert_eq(health.current, 0, "health floors at zero")
```

```powershell
godot --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://test -gexit
```

`-gexit` makes the run quit with a status code. Flag spellings can change between GUT versions, so run `gut_cmdln.gd` with `-gh` for the current list.

## Which Option?

| You are... | Pick |
|-----------|------|
| Starting out, small project | A (check scene), then graduate |
| Want scene-runner and mocks, GDScript and C# | B (gdUnit4) |
| Already using GUT | C, and do not mix two frameworks |

## Cheap Safety Checks (run these first)

```powershell
# Parse a script and exit: catches syntax errors without running the game.
# Caveat: autoloads are not registered here, so scripts that use an autoload name
# report "Identifier not found" even though the game runs fine. The boot check below
# is the authoritative compile test.
godot --headless --path . --check-only --script res://scripts/player.gd

# Boot the project, load the main scene, and quit after a few frames. Catches load-time errors.
godot --headless --path . --quit-after 5

# Rebuild the import cache (needed on a fresh CI checkout before tests can load assets).
godot --headless --path . --import
```

## CI Sketch

```yaml
# .github/workflows/tests.yml (outline only; pin versions you have tested)
steps:
  - uses: actions/checkout@v4
  - name: Install Godot            # use your preferred Godot setup action or a pinned download
    run: echo "install a pinned Godot build here"
  - name: Import assets
    run: godot --headless --path . --import
  - name: Run tests
    run: godot --headless --path . res://tests/verify_logic.tscn
```

Cache the `.godot/` import folder between runs to keep CI fast.

## Pitfalls

| Pitfall | Fix |
|---------|-----|
| Tests pass locally, fail on CI | Missing import step. Run `--import` first. |
| Input simulation does nothing headless | Headless drops input events. Test the logic layer instead, or use a display. |
| Leaked nodes and orphan warnings | `auto_free` (gdUnit4) or `autofree` (GUT), or `free()` in the check scene. |
| Test depends on frame timing | `await` a signal or `simulate_frames`, never a fixed wall-clock sleep. |
| Tests share state through an autoload | Reset the autoload in `before_test()`, or inject the dependency. |
| One giant test | One behavior per test, named for the behavior. |
| Randomness makes tests flaky | Seed a `RandomNumberGenerator` (`rng.seed = 12345`) and pass it in. |

## Related

- Skill: `godot-patterns` for structuring code so layer 1 tests are possible
- Skill: `tdd-workflow` for the red-green-refactor loop
- Agent: `tdd-guide` for test-first guidance
- Agent: `gdscript-reviewer` for review checklists
