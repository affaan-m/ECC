# X Thread Draft — ECC v1.10.0

ECC crossed 140K stars and the public surface had drifted too far from the actual repo.

so v1.10.0 is the sync release.

38 agents
156 skills
72 commands

plugin metadata fixed
install surfaces corrected
docs and release story brought back in line with the live repo

also shipped the operator / media lane that grew out of real usage:

- brand-voice
- social-graph-ranker
- connections-optimizer
- customer-billing-ops
- google-workspace-ops
- project-flow-ops
- workspace-surface-audit
- manim-video
- remotion-video-creation

and most importantly:

ECC 2.0 is no longer just roadmap talk.

the `ecc2/` control-plane alpha is in-tree, builds today, and already exposes:

- dashboard
- start
- sessions
- status
- stop
- resume
- daemon

not calling it GA yet.

calling it what it is:

an actual alpha control plane sitting on top of the harness/workflow layer we’ve been building in public.
