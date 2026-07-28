import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';
import { useStore, useActions } from '../data/store.jsx';
import { askAssistant, assistantAvailable, backendConfigured } from '../data/api.js';
import { buildAssistantContext } from '../data/assistantContext.js';
import { runAssistantTool } from '../data/assistantTools.js';
import { confirmTick, warnTick } from '../data/haptics.js';

// The assistant, as a bubble.
//
// Only ever mounted behind CLERK_ENABLED (so useAuth has a provider) — see
// App.jsx.
//
// The agent loop lives here rather than on the server because the tools it
// calls act on this device's own store. The server holds the API key, the
// system prompt and the tool definitions; the browser posts a conversation,
// gets back one message, runs whatever tools it asked for, and posts the
// results back. See data/assistantTools.js.

// How many round trips one question is allowed. A cap rather than a
// convention: an assistant that mistakenly loops is spending real money, and
// six turns is far more than any of these tools legitimately need.
const MAX_TURNS = 6;

const SUGGESTIONS = [
  "What have I got on tomorrow?",
  "Who haven't I seen in a while?",
  'Find me an hour this week for the gym',
];

// Friendly labels for the "…" line while a tool runs. The user doesn't need
// to know a tool exists, only that something is happening and roughly what.
const TOOL_LABEL = {
  list_schedule: 'Checking your calendar',
  find_contacts: 'Looking through your people',
  get_contact: 'Reading their history',
  create_event: 'Adding to your calendar',
  create_task: 'Adding a task',
  log_interaction: 'Logging that',
  set_follow_up: 'Setting a reminder',
  plan_route: 'Working out the order',
};

export default function AssistantBubble() {
  const { state } = useStore();
  const actions = useActions();
  const { isSignedIn, getToken } = useAuth();
  const navigate = useNavigate();

  const [available, setAvailable] = useState(null); // null = not asked yet
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [changes, setChanges] = useState({}); // tool_use id -> { label, icon, undo, undone }
  const [busy, setBusy] = useState(null); // a TOOL_LABEL string, or 'Thinking'
  const [error, setError] = useState('');
  const [text, setText] = useState('');

  // The loop reads the store between awaits, by which point the version
  // captured at render is one or more dispatches out of date — a second
  // event created in the same conversation would be invisible to the
  // list_schedule call that follows it. Refs give it the current one.
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  // Also a ref, for a different reason: nothing promises that `getToken`
  // keeps its identity between renders, and depending on it directly turned
  // the availability check below into a request per render.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const isPro = !!state.settings?.isPro;
  const enabled = state.settings?.assistantEnabled !== false;
  const couldWork = isSignedIn && isPro && enabled && backendConfigured();

  // Ask the server whether it has an API key before offering the feature.
  // A bubble that opens only to say "not configured" is worse than no bubble.
  useEffect(() => {
    if (!couldWork) return undefined;
    let cancelled = false;
    assistantAvailable(getTokenRef.current)
      .then((r) => !cancelled && setAvailable(!!r.available))
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, [couldWork]);

  // The bubble takes the bottom-left corner, which the Planner's floating
  // conflict warnings also want. They're the ones that have to move (a
  // warning you can't read is worse than one that's shifted along), and
  // they can only know to when something tells them the bubble is there.
  const showBubble = couldWork && available === true;
  useEffect(() => {
    if (!showBubble) return undefined;
    document.body.dataset.assistant = 'on';
    return () => {
      delete document.body.dataset.assistant;
    };
  }, [showBubble]);

  const scrollRef = useRef(null);
  useEffect(() => {
    // Newest message into view. Deliberately not smooth: during a tool loop
    // several land in quick succession and the animations queue up into a
    // long slow crawl.
    const el = scrollRef.current?.closest('.modal-body');
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const runLoop = useCallback(
    async (startConvo) => {
      let convo = startConvo;
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        setBusy('Thinking');
        const reply = await askAssistant(
          getTokenRef.current,
          convo,
          buildAssistantContext(stateRef.current)
        );
        // The assistant message goes back into the conversation exactly as
        // it came, thinking blocks and all — dropping those breaks the next
        // request when there are tool results to return alongside them.
        convo = [...convo, { role: 'assistant', content: reply.content }];
        setMessages(convo);
        if (reply.stop_reason !== 'tool_use') return;

        const results = [];
        for (const block of reply.content) {
          if (block.type !== 'tool_use') continue;
          setBusy(TOOL_LABEL[block.name] || 'Working on it');
          const r = runAssistantTool(block.name, block.input, {
            state: stateRef.current,
            actions: actionsRef.current,
          });
          if (r.change) {
            confirmTick();
            setChanges((prev) => ({ ...prev, [block.id]: { ...r.change, undone: false } }));
          }
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: r.content,
            ...(r.is_error ? { is_error: true } : {}),
          });
        }
        convo = [...convo, { role: 'user', content: results }];
        setMessages(convo);
        // Yield so React commits the dispatches those tools just made,
        // before the next turn reads the store again.
        await new Promise((r) => setTimeout(r, 0));
      }
      setError('That got stuck going in circles — try asking a smaller question.');
    },
    []
  );

  const send = async (value) => {
    const body = (value ?? text).trim();
    if (!body || busy) return;
    setError('');
    setText('');
    const convo = [...messages, { role: 'user', content: body }];
    setMessages(convo);
    try {
      await runLoop(convo);
    } catch (err) {
      warnTick();
      if (err.code === 'upgrade_required') setError('The assistant is part of Pro.');
      else if (err.code === 'not_configured') {
        setError('The assistant is switched off on this server.');
        setAvailable(false);
      } else setError(err.message || "That didn't go through.");
    } finally {
      setBusy(null);
    }
  };

  const undoChange = (id) => {
    const change = changes[id];
    if (!change || change.undone) return;
    change.undo();
    setChanges((prev) => ({ ...prev, [id]: { ...prev[id], undone: true } }));
  };

  const reset = () => {
    setMessages([]);
    setChanges({});
    setError('');
    setText('');
  };

  if (!couldWork || available !== true) return null;

  return (
    <>
      <button
        className="assistant-fab"
        onClick={() => setOpen(true)}
        aria-label="Ask the assistant"
        data-haptic="tap"
      >
        <Icon name="sparkle" size={24} />
      </button>

      <Modal
        open={open}
        tall
        title={
          <>
            <Icon name="sparkle" /> Assistant
          </>
        }
        onClose={() => setOpen(false)}
        footer={
          <div className="assistant-compose">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Ask about your week…"
              aria-label="Message the assistant"
              disabled={!!busy}
            />
            <button
              className="btn btn-primary assistant-send"
              onClick={() => send()}
              disabled={!text.trim() || !!busy}
              aria-label="Send"
            >
              <Icon name="send" />
            </button>
          </div>
        }
      >
        <div className="assistant-log" ref={scrollRef}>
          {messages.length === 0 && !busy && (
            <div className="assistant-intro">
              <p className="muted small">
                It can read your calendar, your tasks and your people, and add things for you.
                Anything it adds can be undone right here.
              </p>
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="assistant-suggestion" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageRow key={i} message={m} changes={changes} onUndo={undoChange} />
          ))}

          {busy && (
            <div className="assistant-status">
              <span className="assistant-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {busy}…
            </div>
          )}

          {error && (
            <div className="assistant-error">
              <Icon name="warning" size={15} /> {error}
              {error.includes('Pro') && (
                <button
                  className="btn btn-ghost small"
                  onClick={() => {
                    setOpen(false);
                    navigate('/pricing');
                  }}
                >
                  See Pro
                </button>
              )}
            </div>
          )}
        </div>

        {messages.length > 0 && !busy && (
          <button className="assistant-reset" onClick={reset}>
            Start a new conversation
          </button>
        )}
      </Modal>
    </>
  );
}

// One turn, rendered. Tool traffic is deliberately not shown as messages —
// the interesting part of a tool call is what it changed, which is the chip,
// and the rest is machinery.
function MessageRow({ message, changes, onUndo }) {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return <div className="assistant-msg assistant-msg--me">{message.content}</div>;
    }
    return null; // tool results
  }

  const blocks = Array.isArray(message.content) ? message.content : [];
  const text = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const made = blocks
    .filter((b) => b.type === 'tool_use' && changes[b.id])
    .map((b) => ({ id: b.id, ...changes[b.id] }));

  if (!text && made.length === 0) return null;

  return (
    <>
      {text && <div className="assistant-msg assistant-msg--them">{text}</div>}
      {made.map((c) => (
        <div key={c.id} className={`assistant-change${c.undone ? ' assistant-change--undone' : ''}`}>
          <Icon name={c.icon} size={15} />
          <span className="assistant-change-label">{c.label}</span>
          {c.undone ? (
            <span className="muted small">Undone</span>
          ) : (
            <button className="assistant-undo" onClick={() => onUndo(c.id)}>
              Undo
            </button>
          )}
        </div>
      ))}
    </>
  );
}
