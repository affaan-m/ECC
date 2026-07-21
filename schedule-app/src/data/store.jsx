import { createContext, useContext, useEffect, useReducer } from 'react';
import { makeSeed } from './seed.js';
import { uid } from './helpers.js';

const STORAGE_KEY = 'compass.data.v1';

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
      eventTypes: parsed.eventTypes || seed.eventTypes,
      tasks: parsed.tasks || [],
      notes: parsed.notes || [],
      settings: {
        theme: 'system',
        reconnectDays: 30,
        notifications: false,
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
        eventBlockOpacity: 100,
        // Map
        mapShowContactPins: true,
        mapShowCustomPins: true,
        mapEmojiSize: 100,
        // Appearance / people
        contactIconSize: 'md',
        taskCompleteAnim: true,
        hapticsEnabled: true,
        ...(parsed.settings || {}),
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
        // Unlink the deleted contact from any events and pins.
        events: state.events.map((e) =>
          e.contactId === action.id ? { ...e, contactId: '' } : e
        ),
        pins: (state.pins || []).map((p) =>
          p.contactId === action.id ? { ...p, contactId: '' } : p
        ),
      };
    case 'CLEAR_CONTACTS':
      return {
        ...state,
        contacts: [],
        events: state.events.map((e) => (e.contactId ? { ...e, contactId: '' } : e)),
        pins: (state.pins || []).map((p) => (p.contactId ? { ...p, contactId: '' } : p)),
      };

    // Map pins
    case 'ADD_PIN':
      return { ...state, pins: [...(state.pins || []), action.pin] };
    case 'UPDATE_PIN':
      return { ...state, pins: upsert(state.pins || [], action.pin) };
    case 'DELETE_PIN':
      return { ...state, pins: (state.pins || []).filter((p) => p.id !== action.id) };

    // Event types (user-defined, with a color)
    case 'ADD_EVENT_TYPE':
      return { ...state, eventTypes: [...(state.eventTypes || []), action.eventType] };
    case 'UPDATE_EVENT_TYPE':
      return { ...state, eventTypes: upsert(state.eventTypes || [], action.eventType) };
    case 'DELETE_EVENT_TYPE':
      return {
        ...state,
        eventTypes: (state.eventTypes || []).filter((t) => t.id !== action.id),
        events: state.events.map((e) => (e.typeId === action.id ? { ...e, typeId: '' } : e)),
      };

    // Tasks (checkable, with an optional reminder)
    case 'ADD_TASK':
      return { ...state, tasks: [...(state.tasks || []), action.task] };
    case 'UPDATE_TASK':
      return { ...state, tasks: upsert(state.tasks || [], action.task) };
    case 'DELETE_TASK':
      return { ...state, tasks: (state.tasks || []).filter((t) => t.id !== action.id) };

    // Notes (Keep-style: free text or a checklist)
    case 'ADD_NOTE':
      return { ...state, notes: [action.note, ...(state.notes || [])] };
    case 'UPDATE_NOTE':
      return { ...state, notes: upsert(state.notes || [], action.note) };
    case 'DELETE_NOTE':
      return { ...state, notes: (state.notes || []).filter((n) => n.id !== action.id) };

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
        statuses: state.statuses,
        eventTypes: state.eventTypes,
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

    addEventType: (data) => dispatch({ type: 'ADD_EVENT_TYPE', eventType: { id: uid('et'), ...data } }),
    updateEventType: (eventType) => dispatch({ type: 'UPDATE_EVENT_TYPE', eventType }),
    deleteEventType: (id) => dispatch({ type: 'DELETE_EVENT_TYPE', id }),

    addContact: (data) =>
      dispatch({ type: 'ADD_CONTACT', contact: { id: uid('c'), tags: [], ...data } }),
    updateContact: (contact) => dispatch({ type: 'UPDATE_CONTACT', contact }),
    deleteContact: (id) => dispatch({ type: 'DELETE_CONTACT', id }),
    clearContacts: () => dispatch({ type: 'CLEAR_CONTACTS' }),

    addPin: (data) => dispatch({ type: 'ADD_PIN', pin: { id: uid('p'), ...data } }),
    updatePin: (pin) => dispatch({ type: 'UPDATE_PIN', pin }),
    deletePin: (id) => dispatch({ type: 'DELETE_PIN', id }),

    addTask: (data) =>
      dispatch({ type: 'ADD_TASK', task: { id: uid('t'), done: false, reminder: null, ...data } }),
    updateTask: (task) => dispatch({ type: 'UPDATE_TASK', task }),
    deleteTask: (id) => dispatch({ type: 'DELETE_TASK', id }),

    addNote: (data) =>
      dispatch({
        type: 'ADD_NOTE',
        note: { id: uid('n'), title: '', body: '', checklist: null, color: '', pinned: false, reminder: null, ...data },
      }),
    updateNote: (note) => dispatch({ type: 'UPDATE_NOTE', note }),
    deleteNote: (id) => dispatch({ type: 'DELETE_NOTE', id }),

    addStatus: (data) => dispatch({ type: 'ADD_STATUS', status: { id: uid('st'), ...data } }),
    updateStatus: (status) => dispatch({ type: 'UPDATE_STATUS', status }),
    deleteStatus: (id) => dispatch({ type: 'DELETE_STATUS', id }),

    setSettings: (settings) => dispatch({ type: 'SET_SETTINGS', settings }),
    importData: (data) => dispatch({ type: 'IMPORT_DATA', data }),
    resetData: () => dispatch({ type: 'RESET_DATA' }),
    clearData: () => dispatch({ type: 'CLEAR_DATA' }),
  };
}
