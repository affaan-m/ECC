import { todayISO } from './helpers.js';

// What a swipe on a People row can do, and which one each direction is bound
// to (see Settings → People swipe actions).
//
// Defined as data rather than inline in the page so the settings dropdowns
// and the row itself read from one list — adding an action here makes it
// selectable and runnable with no further wiring.
//
// `run` gets a small context bag instead of reaching for hooks, so this file
// stays plain data and the page keeps ownership of navigation and toasts.
export const CONTACT_SWIPE_ACTIONS = {
  none: {
    label: 'Nothing',
    icon: '',
    tone: 'transparent',
    // A `null` entry is what SwipeRow checks to refuse the gesture outright,
    // so this one is resolved away rather than being a no-op action.
    disabled: true,
  },
  log: {
    label: 'Log contact',
    icon: 'check',
    tone: 'var(--good)',
    run: ({ contact, actions, showToast }) => {
      const today = todayISO();
      actions.addInteraction({ contactId: contact.id, date: today, text: '', createdAt: today });
      actions.updateContact({ ...contact, lastContacted: today });
      showToast(`Logged contact with ${contact.name.split(' ')[0]}`);
    },
  },
  schedule: {
    label: 'Schedule',
    icon: 'calendar',
    tone: 'var(--accent)',
    run: ({ contact, navigate }) => {
      navigate('/planner', { state: { newEventContact: contact.id } });
    },
  },
  followUp: {
    label: 'Follow up',
    icon: 'personCheck',
    tone: '#8a5cd1',
    run: ({ contact, navigate }) => {
      navigate(`/contacts/${contact.id}`, { state: { openFollowUp: true } });
    },
  },
  call: {
    label: 'Call',
    icon: 'phone',
    tone: '#2e9e6b',
    // Nothing to call is not an error worth a toast — the action just
    // doesn't apply to this person, same as a disabled button.
    run: ({ contact }) => {
      if (contact.phone) window.location.href = `tel:${contact.phone}`;
    },
  },
  text: {
    label: 'Text',
    icon: 'message',
    tone: '#1f5f8b',
    run: ({ contact }) => {
      if (contact.phone) window.location.href = `sms:${contact.phone}`;
    },
  },
  delete: {
    label: 'Delete',
    icon: 'trash',
    tone: 'var(--danger)',
    destructive: true,
    run: ({ contact, deleteContactWithUndo }) => deleteContactWithUndo(contact),
  },
};

export const CONTACT_SWIPE_OPTIONS = Object.entries(CONTACT_SWIPE_ACTIONS).map(([value, a]) => ({
  value,
  label: a.label,
}));

// Right = the positive one, since dragging a row rightward reads as
// affirming it in every app that does this; left keeps the "do something
// else with it" slot.
export const DEFAULT_CONTACT_SWIPE_RIGHT = 'log';
export const DEFAULT_CONTACT_SWIPE_LEFT = 'schedule';

// Turns a settings key into the descriptor SwipeRow wants, or null when the
// direction is set to Nothing (or names an action that no longer exists).
export function resolveContactSwipe(key, ctx) {
  const action = CONTACT_SWIPE_ACTIONS[key];
  if (!action || action.disabled) return null;
  return {
    label: action.label,
    icon: action.icon,
    tone: action.tone,
    destructive: !!action.destructive,
    run: () => action.run(ctx),
  };
}
