import { createContext, useContext, useEffect, useReducer } from 'react';
import { makeSeed } from './seed.js';
import { uid, todayISO, DEFAULT_KIND_COLORS } from './helpers.js';
import { DEFAULT_HOME_BLOCKS } from './homeBlocks.js';

const STORAGE_KEY = 'compass.data.v1';

// The very first default event types, from before interaction-medium kinds
// existed at all — see the color-backfill comment in loadState() below.
const LEGACY_DEFAULT_TYPE_COLORS = {
  et_personal: '#1f5f8b',
  et_work: '#8a5cd1',
  et_health: '#2e9e6b',
  et_social: '#e08a1e',
};

// --- Persistence -----------------------------------------------------------

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return makeSeed();
    const parsed = JSON.parse(raw);
    const seed = makeSeed();
    // Merge with a fresh seed shape so missing keys never crash the UI, and
    // migrate older records forward (weeklyProgress → progress, period, etc.).
    return {
      ...seed,
      ...parsed,
      goals: (parsed.goals || []).map((g) => ({
        period: 'weekly',
        ...g,
        progress: g.progress || g.weeklyProgress || {},
        reminder: g.reminder || null,
      })),
      // Event types used to be a separate user-managed list (label + color)
      // that events pointed at by id. That's gone — an event now just
      // carries its interaction-medium `kind` directly. Migrate any older
      // record still shaped the old way by resolving its typeId through the
      // now-discarded eventTypes list one last time.
      //
      // Not every old type maps to one of the new fixed kinds — a custom
      // type the user made, or one of the original seed types (Personal,
      // Work, Health, Social) from before kinds existed at all, has no
      // equivalent. Losing the label there is unavoidable, but losing the
      // *color* isn't: bake the old type's color onto the event's own
      // (per-event, already-supported) `color` override so it keeps
      // rendering the way it always did instead of collapsing to the plain
      // accent color.
      events: (parsed.events || seed.events).map((e) => {
        if (e.kind === undefined) {
          const legacyTypes = parsed.eventTypes || [];
          const oldType = e.typeId ? legacyTypes.find((t) => t.id === e.typeId) : null;
          const kind = oldType?.kind || '';
          const color = e.color || (kind ? '' : oldType?.color || '');
          e = { ...e, kind, color };
        }
        // An even older migration (before the color-preservation above
        // existed) already flattened some records to kind: '' with no
        // color, for exactly the four original default types — Personal,
        // Work, Health, Social — that predate kinds entirely. Those events
        // now permanently look already-migrated (kind is defined) so the
        // block above never re-runs for them, and the eventTypes list that
        // would've told us their colors is long gone too. Recover their
        // last-known colors from these fixed ids as a one-time backfill,
        // independent of that guard.
        if (!e.color && !e.kind && LEGACY_DEFAULT_TYPE_COLORS[e.typeId]) {
          e = { ...e, color: LEGACY_DEFAULT_TYPE_COLORS[e.typeId] };
        }
        return e;
      }),
      eventTypes: undefined,
      tasks: (parsed.tasks || []).map((t) => ({
        repeat: 'none',
        completedDates: [],
        subtasks: [],
        ...t,
      })),
      notes: parsed.notes || [],
      interactions: parsed.interactions || [],
      templates: parsed.templates || [],
      settings: {
        theme: 'system',
        reconnectDays: 30,
        notifications: false,
        locationRemindersEnabled: false,
        isPro: false,
        colorScheme: 'default',
        timelineZoom: 1,
        // Calendar
        use24h: false,
        weekStartsSunday: false,
        defaultEventDuration: 60,
        defaultReminderLead: 0,
        timelineStartHour: 6,
        timelineEndHour: 23,
        showTasksOnTimeline: false,
        // Schedule warnings, on by default — the point of them is to catch a
        // clash you hadn't noticed, which only works if they're on until you
        // decide otherwise. Read as `!== false` everywhere so an older saved
        // settings object (which has neither key) still gets them.
        warnOverlaps: true,
        warnTravelTime: true,
        eventBlockOpacity: 100,
        // Map
        mapShowContactPins: true,
        mapShowCustomPins: true,
        mapEmojiSize: 100,
        // Appearance / people
        contactIconSize: 'md',
        // Off would only ever mean "don't compute these" — the fields
        // themselves stay optional on every contact either way, so there's
        // nothing to migrate when someone flips it back on.
        contactBirthdaysEnabled: true,
        // On by default: sync you have to go and find and switch on is sync
        // most people never get. Inert unless signed in, Pro, and a backend
        // is configured, so this costs nothing when it can't do anything —
        // see DataSync in App.jsx. Read as `!== false` everywhere so an
        // older saved settings object (no such key) is also treated as on.
        cloudSync: true,
        // Off unless asked for — see data/reconnect.js. Read as `=== true`
        // everywhere so an older saved settings object (which has no such
        // key) also starts off rather than inheriting the old always-on
        // behaviour.
        reconnectRemindersEnabled: false,
        // The assistant bubble. On by default, but inert unless you're
        // signed in, Pro, a backend is configured *and* that backend has an
        // API key — so for most builds this setting decides nothing and the
        // bubble simply never appears. Read as `!== false` so an older saved
        // settings object (no such key) is also treated as on.
        assistantEnabled: true,
        // Which action each swipe direction runs on a People row. See
        // data/contactSwipe.js for the registry and why these are the
        // defaults.
        contactSwipeRight: 'log',
        contactSwipeLeft: 'schedule',
        // Day/week templates are a Pro power-user feature; hiding the entry
        // point keeps the Planner header uncluttered for everyone else.
        showDayTemplates: true,
        taskCompleteAnim: true,
        hapticsEnabled: true,
        homeBlocks: DEFAULT_HOME_BLOCKS,
        tutorialSeen: false,
        ...(parsed.settings || {}),
        // Per-kind colors for Call/Text/In Person/Email/Other events —
        // customizable in Settings → Calendar → Event colors. Merged key by
        // key, not just carried along by the spread above, so a saved
        // record from before a new kind existed still picks up that kind's
        // default rather than ending up with `undefined`.
        eventKindColors: { ...DEFAULT_KIND_COLORS, ...(parsed.settings?.eventKindColors || {}) },
      },
    };
  } catch {
    return makeSeed();
  }
}

// --- Reducer ---------------------------------------------------------------

function upsert(list, item) {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = { ...next[idx], ...item };
  return next;
}

function reducer(state, action) {
  switch (action.type) {
    // Goals
    case 'ADD_GOAL':
      return { ...state, goals: [...state.goals, action.goal] };
    case 'UPDATE_GOAL':
      return { ...state, goals: upsert(state.goals, action.goal) };
    case 'DELETE_GOAL':
      return { ...state, goals: state.goals.filter((g) => g.id !== action.id) };
    case 'SET_GOAL_PROGRESS': {
      const goals = state.goals.map((g) => {
        if (g.id !== action.id) return g;
        const value = Math.max(0, action.value);
        return { ...g, progress: { ...(g.progress || {}), [action.key]: value } };
      });
      return { ...state, goals };
    }

    // Events
    case 'ADD_EVENT':
      return { ...state, events: [...state.events, action.event] };
    case 'UPDATE_EVENT':
      return { ...state, events: upsert(state.events, action.event) };
    case 'DELETE_EVENT':
      return { ...state, events: state.events.filter((e) => e.id !== action.id) };

    // Contacts
    case 'ADD_CONTACT':
      return { ...state, contacts: [...state.contacts, action.contact] };
    case 'UPDATE_CONTACT':
      return { ...state, contacts: upsert(state.contacts, action.contact) };
    case 'DELETE_CONTACT':
      return {
        ...state,
        contacts: state.contacts.filter((c) => c.id !== action.id),
        // Unlink the deleted contact from any events. Pins the user placed
        // by hand are unlinked too (they still stand on their own); a pin
        // auto-created from the contact's address has no meaning without
        // them, so it's removed outright. Interactions only make sense tied
        // to a person, so those go with them; notes are unlinked (kept) —
        // they're the user's own writing, not just a link.
        events: state.events.map((e) =>
          e.contactId === action.id ? { ...e, contactId: '' } : e
        ),
        pins: (state.pins || [])
          .filter((p) => !(p.contactId === action.id && p.source === 'contact-address'))
          .map((p) => (p.contactId === action.id ? { ...p, contactId: '' } : p)),
        interactions: (state.interactions || []).filter((i) => i.contactId !== action.id),
        notes: (state.notes || []).map((n) =>
          n.contactId === action.id ? { ...n, contactId: '' } : n
        ),
        // "Follow up with <name>" is meaningless once <name> is gone.
        tasks: (state.tasks || []).filter((t) => t.followUpContactId !== action.id),
      };
    case 'CLEAR_CONTACTS':
      return {
        ...state,
        contacts: [],
        events: state.events.map((e) => (e.contactId ? { ...e, contactId: '' } : e)),
        pins: (state.pins || [])
          .filter((p) => !(p.contactId && p.source === 'contact-address'))
          .map((p) => (p.contactId ? { ...p, contactId: '' } : p)),
        interactions: [],
        notes: (state.notes || []).map((n) => (n.contactId ? { ...n, contactId: '' } : n)),
        tasks: (state.tasks || []).filter((t) => !t.followUpContactId),
      };

    // Map pins
    case 'ADD_PIN':
      return { ...state, pins: [...(state.pins || []), action.pin] };
    case 'UPDATE_PIN':
      return { ...state, pins: upsert(state.pins || [], action.pin) };
    case 'DELETE_PIN':
      return { ...state, pins: (state.pins || []).filter((p) => p.id !== action.id) };

    // Tasks (checkable, with an optional reminder)
    case 'ADD_TASK':
      return { ...state, tasks: [...(state.tasks || []), action.task] };
    case 'UPDATE_TASK': {
      const tasks = upsert(state.tasks || [], action.task);
      // A follow-up commitment and the task standing in for it are one thing
      // wearing two hats, so ticking the task has to clear the commitment.
      // Doing it here rather than at the call site means it holds no matter
      // where the task got completed from — Home, Planner, the task list.
      const done = tasks.find((t) => t.id === action.task.id);
      if (done?.followUpContactId && done.done) {
        return {
          ...state,
          tasks,
          contacts: state.contacts.map((c) =>
            c.id === done.followUpContactId ? { ...c, followUp: null } : c
          ),
        };
      }
      return { ...state, tasks };
    }
    case 'DELETE_TASK': {
      const removed = (state.tasks || []).find((t) => t.id === action.id);
      const tasks = (state.tasks || []).filter((t) => t.id !== action.id);
      if (removed?.followUpContactId) {
        return {
          ...state,
          tasks,
          contacts: state.contacts.map((c) =>
            c.id === removed.followUpContactId ? { ...c, followUp: null } : c
          ),
        };
      }
      return { ...state, tasks };
    }

    // Follow-up commitments ("I said I'd call them Tuesday"). The commitment
    // lives on the contact and is mirrored by a real task so it shows up
    // wherever the user already looks for things they owe someone. Both
    // sides move together in one action so they can never disagree.
    case 'SET_FOLLOW_UP': {
      const { contactId, followUp } = action;
      const contact = state.contacts.find((c) => c.id === contactId);
      if (!contact) return state;
      const others = (state.tasks || []).filter((t) => t.followUpContactId !== contactId);
      const contacts = state.contacts.map((c) =>
        c.id === contactId ? { ...c, followUp: followUp || null } : c
      );
      if (!followUp) return { ...state, contacts, tasks: others };
      const existing = (state.tasks || []).find((t) => t.followUpContactId === contactId);
      const task = {
        dueTime: '',
        reminderOffsets: [],
        repeat: 'none',
        completedDates: [],
        location: '',
        // Keep whatever the user already customised on the task (reminders,
        // a time), then let the commitment win on the fields it owns.
        ...existing,
        id: existing?.id || uid('t'),
        title: `Follow up with ${contact.name}`,
        notes: followUp.note || '',
        dueDate: followUp.date,
        followUpContactId: contactId,
        // Re-committing to a date after ticking the old one off should give
        // an open task again, not a pre-completed one.
        done: false,
      };
      return { ...state, contacts, tasks: [...others, task] };
    }

    // Marking a follow-up done is three edits that have to land together:
    // clear the commitment, drop the task mirroring it, and stamp the
    // contact as freshly contacted. Doing it as two dispatches from the UI
    // was the bug — the second one spread a `contact` object captured
    // before the first ran, so it carried the old `followUp` straight back
    // in and the button looked like it did nothing at all.
    case 'COMPLETE_FOLLOW_UP': {
      const { contactId, date } = action;
      return {
        ...state,
        contacts: state.contacts.map((c) =>
          c.id === contactId ? { ...c, followUp: null, lastContacted: date } : c
        ),
        tasks: (state.tasks || []).filter((t) => t.followUpContactId !== contactId),
      };
    }

    // Day / week templates
    case 'ADD_TEMPLATE':
      return { ...state, templates: [...(state.templates || []), action.template] };
    case 'UPDATE_TEMPLATE':
      return { ...state, templates: upsert(state.templates || [], action.template) };
    case 'DELETE_TEMPLATE':
      return { ...state, templates: (state.templates || []).filter((t) => t.id !== action.id) };
    case 'APPLY_TEMPLATE':
      // One dispatch for the whole stamp, so applying a 12-block week is a
      // single undoable state change rather than 12 separate renders.
      return { ...state, events: [...state.events, ...action.events] };

    // Notes (Keep-style: free text or a checklist)
    case 'ADD_NOTE':
      return { ...state, notes: [action.note, ...(state.notes || [])] };
    case 'UPDATE_NOTE':
      return { ...state, notes: upsert(state.notes || [], action.note) };
    case 'DELETE_NOTE':
      return { ...state, notes: (state.notes || []).filter((n) => n.id !== action.id) };

    // Interactions (logged past contact with a person — Timeline page)
    case 'ADD_INTERACTION':
      return { ...state, interactions: [...(state.interactions || []), action.interaction] };
    case 'UPDATE_INTERACTION':
      return { ...state, interactions: upsert(state.interactions || [], action.interaction) };
    case 'DELETE_INTERACTION':
      return { ...state, interactions: (state.interactions || []).filter((i) => i.id !== action.id) };

    // Statuses (user-defined labels)
    case 'ADD_STATUS':
      return { ...state, statuses: [...state.statuses, action.status] };
    case 'UPDATE_STATUS':
      return { ...state, statuses: upsert(state.statuses, action.status) };
    case 'DELETE_STATUS':
      return {
        ...state,
        statuses: state.statuses.filter((s) => s.id !== action.id),
        contacts: state.contacts.map((c) =>
          c.statusId === action.id ? { ...c, statusId: '' } : c
        ),
      };

    // Settings & data management
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } };
    case 'IMPORT_DATA':
      return { ...makeSeed(), ...action.data };
    case 'RESET_DATA':
      return makeSeed();
    case 'CLEAR_DATA':
      return {
        version: 1,
        goals: [],
        events: [],
        contacts: [],
        pins: [],
        tasks: [],
        notes: [],
        interactions: [],
        templates: [],
        statuses: state.statuses,
        settings: state.settings,
      };

    default:
      return state;
  }
}

// --- Context ---------------------------------------------------------------

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or unavailable — app still works for the session */
    }
  }, [state]);

  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

// Convenience action creators bundled as a hook.
export function useActions() {
  const { dispatch } = useStore();
  return {
    addGoal: (data) =>
      dispatch({
        type: 'ADD_GOAL',
        goal: { id: uid('g'), period: 'weekly', progress: {}, reminder: null, ...data },
      }),
    updateGoal: (goal) => dispatch({ type: 'UPDATE_GOAL', goal }),
    deleteGoal: (id) => dispatch({ type: 'DELETE_GOAL', id }),
    setGoalProgress: (id, key, value) =>
      dispatch({ type: 'SET_GOAL_PROGRESS', id, key, value }),

    addEvent: (data) => dispatch({ type: 'ADD_EVENT', event: { id: uid('e'), done: false, ...data } }),
    updateEvent: (event) => dispatch({ type: 'UPDATE_EVENT', event }),
    deleteEvent: (id) => dispatch({ type: 'DELETE_EVENT', id }),

    addContact: (data) =>
      dispatch({ type: 'ADD_CONTACT', contact: { id: data.id || uid('c'), tags: [], ...data } }),
    updateContact: (contact) => dispatch({ type: 'UPDATE_CONTACT', contact }),
    deleteContact: (id) => dispatch({ type: 'DELETE_CONTACT', id }),
    clearContacts: () => dispatch({ type: 'CLEAR_CONTACTS' }),

    addPin: (data) => dispatch({ type: 'ADD_PIN', pin: { id: uid('p'), ...data } }),
    updatePin: (pin) => dispatch({ type: 'UPDATE_PIN', pin }),
    deletePin: (id) => dispatch({ type: 'DELETE_PIN', id }),

    addTask: (data) =>
      dispatch({
        type: 'ADD_TASK',
        task: {
          id: uid('t'),
          done: false,
          dueTime: '',
          reminderOffsets: [],
          repeat: 'none',
          completedDates: [],
          subtasks: [],
          ...data,
        },
      }),
    updateTask: (task) => dispatch({ type: 'UPDATE_TASK', task }),
    deleteTask: (id) => dispatch({ type: 'DELETE_TASK', id }),

    addNote: (data) =>
      dispatch({
        type: 'ADD_NOTE',
        note: { id: uid('n'), title: '', body: '', checklist: null, color: '', pinned: false, reminder: null, ...data },
      }),
    updateNote: (note) => dispatch({ type: 'UPDATE_NOTE', note }),
    deleteNote: (id) => dispatch({ type: 'DELETE_NOTE', id }),

    addInteraction: (data) =>
      dispatch({ type: 'ADD_INTERACTION', interaction: { id: uid('ix'), ...data } }),
    updateInteraction: (interaction) => dispatch({ type: 'UPDATE_INTERACTION', interaction }),
    deleteInteraction: (id) => dispatch({ type: 'DELETE_INTERACTION', id }),

    setFollowUp: (contactId, followUp) => dispatch({ type: 'SET_FOLLOW_UP', contactId, followUp }),
    completeFollowUp: (contactId) =>
      dispatch({ type: 'COMPLETE_FOLLOW_UP', contactId, date: todayISO() }),

    addTemplate: (template) => dispatch({ type: 'ADD_TEMPLATE', template }),
    updateTemplate: (template) => dispatch({ type: 'UPDATE_TEMPLATE', template }),
    deleteTemplate: (id) => dispatch({ type: 'DELETE_TEMPLATE', id }),
    applyTemplate: (events) => dispatch({ type: 'APPLY_TEMPLATE', events }),

    addStatus: (data) => dispatch({ type: 'ADD_STATUS', status: { id: uid('st'), ...data } }),
    updateStatus: (status) => dispatch({ type: 'UPDATE_STATUS', status }),
    deleteStatus: (id) => dispatch({ type: 'DELETE_STATUS', id }),

    setSettings: (settings) => dispatch({ type: 'SET_SETTINGS', settings }),
    importData: (data) => dispatch({ type: 'IMPORT_DATA', data }),
    resetData: () => dispatch({ type: 'RESET_DATA' }),
    clearData: () => dispatch({ type: 'CLEAR_DATA' }),
  };
}
