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
      const [h, m] = start.split(':').map(Number);
      const endMins = Math.min(23 * 60 + 59, h * 60 + m + 60);
      const end = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
      actions.addEvent({
        title: parsed.title,
        date,
        start,
        end,
        contactId: '',
        location: '',
        locLat: null,
        locLng: null,
        notes: '',
        done: false,
        repeat: 'none',
        repeatUntil: '',
        repeatDays: [],
        typeId: '',
        color: '',
        reminder: 0,
      });
      showToast(`"${parsed.title}" added to your calendar`);
    } else {
      actions.addTask({
        title: parsed.title,
        notes: '',
        location: '',
        // A task with no date stays undated — unlike an event, which has to
        // land somewhere, a task without a due date is a legitimate state.
        dueDate: parsed.date || '',
        dueTime: parsed.time || '',
        reminderOffsets: [],
      });
      showToast(`"${parsed.title}" added to your tasks`);
    }
  };
}
