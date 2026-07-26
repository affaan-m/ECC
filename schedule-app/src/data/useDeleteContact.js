import { useStore, useActions } from './store.jsx';
import { useToast } from './toast.jsx';

// Deleting a contact cascades — it unlinks their events/notes, drops any pin
// auto-created from their address, and deletes their interactions (see
// DELETE_CONTACT in store.jsx) — so undo has to snapshot and restore all of
// that, not just re-add the contact itself. Shared by the People list
// (swipe-to-delete) and the contact detail page's own Delete button.
export function useDeleteContactWithUndo() {
  const { state } = useStore();
  const actions = useActions();
  const showToast = useToast();

  return (c) => {
    const affectedEvents = state.events.filter((e) => e.contactId === c.id);
    const removedPins = (state.pins || []).filter((p) => p.contactId === c.id && p.source === 'contact-address');
    const unlinkedPins = (state.pins || []).filter((p) => p.contactId === c.id && p.source !== 'contact-address');
    const affectedInteractions = (state.interactions || []).filter((i) => i.contactId === c.id);
    const affectedNotes = state.notes.filter((n) => n.contactId === c.id);

    actions.deleteContact(c.id);

    showToast(`"${c.name}" deleted`, 'Undo', () => {
      actions.addContact(c);
      affectedEvents.forEach((e) => actions.updateEvent({ ...e, contactId: c.id }));
      unlinkedPins.forEach((p) => actions.updatePin({ ...p, contactId: c.id }));
      removedPins.forEach((p) => actions.addPin(p));
      affectedInteractions.forEach((i) => actions.addInteraction(i));
      affectedNotes.forEach((n) => actions.updateNote({ ...n, contactId: c.id }));
    });
  };
}
