---
description: Save verification state and progress checkpoint
agent: build
---

# Checkpoint Command

Save current verification state and create progress checkpoint: $ARGUMENTS

## Your Task

Create a snapshot of current progress including:

1. **Tests status** - Which tests pass/fail
2. **Coverage** - Current coverage metrics
3. **Build status** - Build succeeds or errors
4. **Code changes** - Summary of modifications
5. **Next steps** - What remains to be done

## Checkpoint Format

### Checkpoint: [Timestamp]

**Tests**
- Total: X
- Passing: Y
- Failing: Z
- Coverage: XX%

**Build**
- Status: PASS: Passing / FAIL: Failing
- Errors: [if any]

**Changes Since Last Checkpoint**
```
git diff --stat [last-checkpoint-commit]
```

**Completed Tasks**
- [x] Task 1
- [x] Task 2
- [ ] Task 3 (in progress)

**Blocking Issues**
- [Issue description]

**Next Steps**
1. Step 1
2. Step 2

## Usage with Verification Loop

Checkpoints integrate with the verification loop:

```
/plan → implement → /checkpoint → /verify → /checkpoint → implement → ...
```

Use checkpoints to:
- Save state before risky changes
- Track progress through phases
- Enable rollback if needed
- Document verification points

---

**TIP**: Create checkpoints at natural breakpoints: after each phase, before major refactoring, after fixing critical bugs.
