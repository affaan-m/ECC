---
name: blender-motion-state-inspection
description: Use this skill when inspecting Blender characters, rigs, poses, animation retargeting, ground contact, facing direction, or model-vs-motion alignment where screenshots alone are not enough.
---

# Blender Motion State Inspection

## When to Use

- A Blender character looks twisted, mirrored, flattened, offset, or foot-sliding in an animation.
- A user asks whether an imported avatar, armature, or retargeted motion matches an expected pose.
- You need to compare rendered evidence with structured facts such as bones, bounding boxes, contacts, and facing vectors.
- A workflow depends on deciding whether a model is a character, prop, proxy mesh, control rig, or broken import.

## Core Principle

Do not judge animated 3D assets only from screenshots. Screenshots are review evidence, but they hide axis conventions, bone names, object scale, local transforms, parented meshes, material slots, and frame-by-frame contact state.

First extract structured Blender state, then use viewport screenshots or renders to confirm what the facts imply.

## How It Works

1. Establish the clean scene and asset baseline before judging motion.
2. Extract structured facts from Blender using an exporter or Blender Python run inside Blender's own interpreter.
3. Sample the frames most likely to expose contact, orientation, scale, and retargeting errors.
4. Compare the measured facts against the user's expected pose, direction, ground plane, and render goal.
5. Return a concise report that separates confirmed facts, likely causes, and required fixes.

## Inspection Workflow

1. Inventory the scene.
   - List meshes, armatures, empties, cameras, lights, modifiers, parent relationships, and hidden objects.
   - Separate character meshes from helper/proxy geometry before judging the avatar.
   - Record object-space and world-space bounding boxes.

2. Identify the skeleton.
   - Capture armature names, pose bones, bone heads/tails, roll, parent chains, constraints, and rest-pose axes.
   - Map semantic bones such as hips, spine, neck, head, shoulders, elbows, hands, thighs, knees, ankles, and feet.
   - Flag missing left/right pairs and unusual naming schemes.

3. Determine forward, up, and side axes.
   - Use the pelvis, spine, shoulders, hips, head, and feet together; do not rely on a single mesh normal.
   - Compare local armature axes with world axes and imported file conventions such as glTF Y-up vs Blender Z-up.
   - Mark likely mirrored or backwards imports when face/head/feet direction conflicts with root motion.

4. Sample animation frames.
   - Inspect first, middle, contact, airborne, and extreme frames.
   - Record root location, root heading, pelvis height, torso lean, limb directions, foot clearance, and mesh bounds.
   - For long or fast motion, sample more densely around flips, landings, turns, collisions, and floor contacts.

5. Check model integrity before retargeting blame.
   - Confirm the clean baseline shape before applying animation.
   - Preserve original mesh, materials, armature, and skinning unless the user explicitly asks for repair.
   - Treat unexplained sphere-like blobs, giant proxy meshes, or crushed bodies as import/selection issues until proven otherwise.

6. Diagnose contact and motion issues.
   - Ground penetration: compare lowest foot or shoe vertices with floor height per frame.
   - Foot sliding: compare foot world positions across planted frames.
   - Leg crossover: compare left/right thigh, knee, ankle, and foot side ordering.
   - Twist damage: compare bone swing direction separately from roll/twist around the limb axis.
   - Scale drift: compare animated mesh bounds against the clean baseline bounds.

7. Report facts before opinions.
   - Include frame numbers, object names, bone names, world coordinates, and thresholds.
   - Separate confirmed failures from visual suspicions.
   - Attach screenshots only after the structured state explains what to look for.

## Recommended Report Shape

```markdown
## Blender Motion Inspection

### Scene Inventory
- Character candidates:
- Armatures:
- Helper/proxy objects:
- Cameras/lights:

### Orientation
- World up:
- Character forward:
- Root heading:
- Mirrored/backwards risk:

### Baseline Integrity
- Clean mesh bounds:
- Animated mesh bounds:
- Materials/skin preserved:
- Suspicious non-character meshes:

### Frame Findings
| Frame | Finding | Evidence |
| --- | --- | --- |
| 1 | Clean baseline pose | hips/spine/feet aligned |
| 96 | Foot penetrates floor | left_foot min_z = -0.04 |

### Verdict
- Pass/fail:
- Required fix:
- Render readiness:
```

## Examples

### Walk Cycle With Foot Sliding

Scenario: a retargeted character appears to skate during a walk cycle, but the front camera angle makes the foot contact hard to judge.

Apply the workflow:
- Inventory the scene: character mesh `HeroBody`, armature `HeroRig`, ground plane `Floor`, no hidden proxy meshes.
- Identify the skeleton: semantic feet are `foot.L` and `foot.R`; hips are `pelvis`; root bone is `root`.
- Sample animation frames: inspect frames 1, 18, 24, 30, 42, and 48 around planted-foot moments.
- Diagnose contact and motion issues: compare world-space foot locations during planted frames.

Extracted facts:

| Frame | Fact | Evidence |
| --- | --- | --- |
| 18 | Left foot is planted | `foot.L min_z = 0.004`, toe and heel both near floor |
| 24 | Left foot slides while planted | `foot.L x = 0.21 -> 0.28` over six frames |
| 30 | Pelvis keeps moving forward | `pelvis y = 1.14 -> 1.31` |

Verdict: fail for render readiness. The motion needs foot-lock cleanup or retargeting constraint review; the body mesh does not need proportion changes.

### Backwards Imported Character

Scenario: a character looks correct in a still frame, but the animation moves opposite the expected travel direction.

Apply the workflow:
- Determine forward, up, and side axes: compare head, chest, feet, and root motion.
- Sample animation frames: inspect frame 1 and the midpoint of the travel path.
- Report facts before opinions: include the root heading and model-facing direction separately.

Extracted facts:

| Frame | Fact | Evidence |
| --- | --- | --- |
| 1 | Character face points toward world `-Y` | head/chest vector from `neck` to `head` resolves to `-Y` |
| 72 | Root motion travels toward world `+Y` | `root y = 0.0 -> 2.8` |
| 72 | Feet remain visually forward-facing opposite travel | toe bones point `-Y` while displacement is `+Y` |

Verdict: likely backwards import or retargeting forward-axis mismatch. Fix the import/retarget axis mapping before editing animation curves.

## Practical Thresholds

- Assume Blender's default meter-scale units unless the scene unit scale says otherwise.
- Treat ground penetration above 1-2 cm as visible unless the floor is soft or intentionally stylized.
- Treat a sudden scale change above 5% as a likely rig, constraint, or transform inheritance problem.
- Treat left/right ankle side-order flips during airborne inverted motion as leg crossover risk even if it recovers later.
- Treat root heading jumps above 30 degrees per frame as suspicious unless the source motion includes a snap turn.

## Anti-Patterns

- Do not modify body proportions to force pose matching unless the task is explicitly mesh repair.
- Do not bake away the clean baseline before recording it.
- Do not use one rendered camera angle as proof that a pose is correct.
- Do not delete helper objects until you have recorded why they are not part of the character.
- Do not assume an avatar faces +Y, -Y, +X, or -X without checking head, feet, torso, and root motion together.

## Tooling Notes

If a Blender state exporter is available, prefer JSON that includes meshes, armatures, pose bones, materials, contacts, bounding boxes, and sampled animation frames. If no exporter exists, run a small Blender Python script through Blender itself, for example `blender --background scene.blend --python collect_motion_state.py`, because `bpy` is not available in a normal system Python interpreter.
