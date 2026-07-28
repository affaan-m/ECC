import { Children } from 'react';
import { selectTick } from '../data/haptics.js';

// A settings card that collapses to just its heading.
//
// The Settings page is one long scroll of nineteen cards; finding the one
// you want means scrolling past everything else. Collapsed by default, it
// becomes a scannable index instead.
//
// The heading isn't a prop — it's whatever the section's *first child*
// already was. That matters because the existing cards lead with two
// different shapes: some a bare `.detail-label`, some a `.section-head`
// with the label and a control (a toggle, an "+ Add" button) side by side.
// Taking the first child verbatim means both keep working untouched, and
// a toggle that lives in a heading stays reachable while collapsed —
// flipping notifications off shouldn't require expanding anything.
export default function SettingsGroup({ id, open, onToggle, children }) {
  const kids = Children.toArray(children);
  const [head, ...body] = kids;

  return (
    <section className={`detail-section settings-group${open ? ' settings-group--open' : ''}`}>
      <div
        className="settings-group-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={`settings-body-${id}`}
        onClick={(e) => {
          // A control that lives in the heading (the notifications toggle,
          // "+ Add") acts on its own — don't also collapse the card out
          // from under the tap.
          if (e.target.closest('button, a, input, [role="switch"]')) return;
          selectTick();
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="settings-group-title">{head}</div>
        <ChevronIcon />
      </div>
      {open && (
        <div className="settings-group-body" id={`settings-body-${id}`}>
          {body}
        </div>
      )}
    </section>
  );
}

function ChevronIcon() {
  return (
    <svg className="settings-group-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
