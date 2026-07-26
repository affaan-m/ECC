import { useStore, useActions } from './store.jsx';
import { useToast } from './toast.jsx';

// Deleting a contact cascades — it unlinks their events/notes, drops any pin
// auto-created from their address, and deletes their interactions (see
// DELETE_CONTACT in store.jsx) — so undo has to snapshot and restore all of
// that, not just re-add the contact itself. Shared by the People list
// (swipe-to-delete, and the bulk "Delete selected" action) and the contact
// detail page's own Delete button. Accepts either a single contact or an
// array of them (bulk delete) — either way there's one undo-able toast.
export function useDeleteContactWithUndo() {
  const { state } = useStore();
  const actions = useActions();
  const showToast = useToast();

  return (input) => {
    const list = Array.isArray(input) ? input : [input];
    if (list.length === 0) return;

    const snapshots = list.map((c) => ({
      contact: c,
      affectedEvents: state.events.filter((e) => e.contactId === c.id),
      removedPins: (state.pins || []).filter((p) => p.contactId === c.id && p.source === 'contact-address'),
      unlinkedPins: (state.pins || []).filter((p) => p.contactId === c.id && p.source !== 'contact-address'),
      affectedInteractions: (state.interactions || []).filter((i) => i.contactId === c.id),
      affectedNotes: state.notes.filter((n) => n.contactId === c.id),
    }));

    list.forEach((c) => actions.deleteContact(c.id));

    const label = list.length === 1 ? `"${list[0].name}" deleted` : `${list.length} people deleted`;
    showToast(label, 'Undo', () => {
      for (const s of snapshots) {
        actions.addContact(s.contact);
        s.affectedEvents.forEach((e) => actions.updateEvent({ ...e, contactId: s.contact.id }));
        s.unlinkedPins.forEach((p) => actions.updatePin({ ...p, contactId: s.contact.id }));
        s.removedPins.forEach((p) => actions.addPin(p));
        s.affectedInteractions.forEach((i) => actions.addInteraction(i));
        s.affectedNotes.forEach((n) => actions.updateNote({ ...n, contactId: s.contact.id }));
      }
    });
  };
}
