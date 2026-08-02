// Whether the Claude-powered assistant is offered at all in this build.
// Off for now — the app is meant to be fully usable offline, and the
// assistant is the one feature that inherently isn't (it needs Clerk, a
// backend, a network connection, and an Anthropic API key). Everything the
// assistant is built on (AssistantBubble, assistantTools.js,
// assistantContext.js, the backend's /api/assistant route) is left in place
// as-is; this is the single switch back on when it's wanted again.
export const AI_ENABLED = false;
