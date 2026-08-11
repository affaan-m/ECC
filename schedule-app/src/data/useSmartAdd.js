import { useActions } from './store.jsx';
import { useToast } from './toast.jsx';
import { todayISO } from './helpers.js';

// Turns a parsed smart-add result into a real task or event. Shared, because
// the quick-add FAB offers Smart add on every page that has one — the Planner
// used to render that pill and then silently ignore the tap, since only Home
// knew how to act on it.
//
// `fallbackDate` is the date to use when the text didn't name one. On Home
// that's today; on the Planner it's the day being looked at, so "gym 6pm"
// typed while browsing next Tuesday lands on next Tuesday rather than today.
export function useSmartAdd(fallbackDate) {
  const actions = useActions();
  const showToast = useToast();

  return (kind, parsed) => {
    const date = parsed.date || fallbackDate || todayISO();
    if (kind === 'event') {
      const start = parsed.time || '09:00';
      const end = parsed.endTime || plusMinutes(start, parsed.durationMinutes || 60);
      actions.addEvent({
        title: parsed.title,
        date,
        start,
        end,
        contactId: parsed.contactId || '',
        location: parsed.location || '',
        locLat: null,
        locLng: null,
        notes: '',
        done: false,
        repeat: parsed.repeat || 'none',
        repeatUntil: '',
        repeatDays: parsed.repeatDays || [],
        kind: '',
        color: '',
        reminder: parsed.reminderMinutes || 0,
      });
      showToast(`"${parsed.title}" added to your calendar`);
    } else {
      actions.addTask({
        title: parsed.title,
        notes: '',
        location: parsed.location || '',
        // A task with no date stays undated — unlike an event, which has to
        // land somewhere, a task without a due date is a legitimate state.
        dueDate: parsed.date || '',
        dueTime: parsed.time || '',
        // A lead time is only meaningful against a moment, so it's dropped
        // for an undated task rather than silently stored against nothing.
        reminderOffsets:
          parsed.reminderMinutes && parsed.date ? [parsed.reminderMinutes] : [],
        repeat: parsed.repeat || 'none',
      });
      showToast(`"${parsed.title}" added to your tasks`);
    }
  };
}

function plusMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + mins);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
