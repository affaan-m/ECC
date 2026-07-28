// A heading over a run of settings cards.
//
// Nineteen collapsed cards in a flat list is a wall of equal-weight rows —
// you can read every title and still not know where to look, because
// nothing says which ones belong together. These break the page into seven
// named runs, so scanning is "which area is this in" first and "which card"
// second.
//
// Deliberately not a container: the cards stay siblings in the page's own
// flow, so the existing spacing between them is untouched and a section
// can be hidden by search without taking its cards with it.
export default function SettingsSection({ label, hidden }) {
  if (hidden) return null;
  return <h2 className="settings-section">{label}</h2>;
}
