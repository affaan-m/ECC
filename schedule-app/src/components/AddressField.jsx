import { useEffect, useRef, useState } from 'react';
import { suggestAddresses } from '../data/geocode.js';
import Icon from './Icon.jsx';

// Address input with lookup suggestions.
//
// The point isn't convenience so much as accuracy: saving a contact used to
// fire a one-shot geocode of whatever was typed and take the first hit, which
// for anything ambiguous ("120 Main St") could land the pin in the wrong town
// entirely. Picking from a list settles that at entry time, and the chosen
// result's own coordinates are handed back so nothing re-guesses later.
//
// Typing without picking still works exactly as before — free text, geocoded
// on save — so this never blocks someone who knows what they mean.
//
// Nominatim asks for no more than one request a second, hence the debounce
// and the 4-character floor. Superseded requests are aborted so a fast typist
// doesn't queue up a burst of them.
const DEBOUNCE_MS = 550;

export default function AddressField({ value, onChange, placeholder, autoFocus, onSubmit }) {
  const [suggestions, setSuggestions] = useState([]);
  // The exact text `suggestions` was fetched for. Typing further while a
  // fetch is in flight used to leave the previous keystroke's results on
  // screen — fully clickable — for the whole 550ms debounce plus network
  // time, so tapping the visible (but stale) top result could silently pick
  // an address for text you'd already moved past rather than what you'd
  // actually finished typing. Gating the list on this match, rather than
  // clearing it outright on every keystroke, keeps it from also flashing
  // empty while you're mid-edit of an address it already has real results
  // for.
  const [suggestionsFor, setSuggestionsFor] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Set when the current text came from a picked suggestion, so we don't
  // immediately re-query the text we just wrote into the field.
  const justPickedRef = useRef(false);
  const abortRef = useRef(null);

  useEffect(() => {
    if (justPickedRef.current) {
      justPickedRef.current = false;
      return undefined;
    }
    const q = (value || '').trim();
    if (q.length < 4) {
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const found = await suggestAddresses(q, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setSuggestions(found);
      setSuggestionsFor(q);
      setLoading(false);
      if (found.length) setOpen(true);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pick = (s) => {
    justPickedRef.current = true;
    onChange(s.label, { lat: s.lat, lng: s.lng });
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div className="address-field">
      <input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value, null)}
        onFocus={() => suggestions.length && setOpen(true)}
        // A blur that lands on a suggestion must not close the list before
        // the tap registers, so closing waits a beat.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) {
            setOpen(false);
            onSubmit();
          }
        }}
        autoComplete="off"
      />
      {loading && <span className="address-field-hint muted small">Looking up…</span>}
      {open && suggestions.length > 0 && suggestionsFor === (value || '').trim() && (
        <ul className="address-suggestions">
          {suggestions.map((s) => (
            <li key={`${s.lat},${s.lng}`}>
              <button type="button" className="address-suggestion" onMouseDown={() => pick(s)}>
                <Icon name="pin" size={15} /> {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
