import { daysSince } from './helpers.js';

// "Time to reconnect" flags people you haven't been in touch with lately.
//
// It used to fire on *every* contact, counting from `createdAt` when there
// was no `lastContacted` — so the moment you imported a phonebook, or added
// someone you'd never actually spoken to, the app started nagging you about
// letting a relationship lapse that had never existed. That's noise, and
// worse, it's wrong: there's no lapse to report if there was never a first
// contact to lapse from.
//
// So it now only applies to people with an actual history — someone you've
// logged an interaction with, or explicitly marked as contacted. And because
// it's an opinionated behaviour that not everyone wants at all, the whole
// thing is off unless you turn it on.

export function reconnectDaysOf(contact, defaultDays) {
  const days = Number(contact.cadenceDays) || defaultDays;
  return days > 0 ? days : 0;
}

// Is there anything to lapse *from*? Either a logged interaction on their
// timeline, or a lastContacted stamp (set by logging contact, or by marking
// a follow-up done). `createdAt` deliberately doesn't count — being added to
// the app is not the same as having been spoken to.
export function hasContactHistory(contact, interactions) {
  if (contact.lastContacted) return true;
  return (interactions || []).some((i) => i.contactId === contact.id);
}

// Builds the predicate every page uses, closing over the one settings read
// and the interaction list so call sites stay a plain `isOverdue(contact)`.
export function makeOverdueCheck(state) {
  const enabled = state.settings?.reconnectRemindersEnabled === true;
  const defaultDays = state.settings?.reconnectDays ?? 30;
  const interactions = state.interactions || [];
  return (contact) => {
    if (!enabled || !contact) return false;
    if (!hasContactHistory(contact, interactions)) return false;
    const days = reconnectDaysOf(contact, defaultDays);
    if (!days) return false;
    // Safe now that history is required: lastContacted is guaranteed set
    // unless the history came from an interaction, in which case fall back
    // to the most recent one rather than to createdAt.
    const since = contact.lastContacted
      ? daysSince(contact.lastContacted)
      : daysSince(
          interactions
            .filter((i) => i.contactId === contact.id)
            .map((i) => i.date)
            .sort()
            .pop()
        );
    return since >= days;
  };
}
