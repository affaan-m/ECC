import { useEffect, useState } from 'react';

// An app-styled replacement for the native <select>, so dropdowns look and
// feel consistent everywhere instead of the browser's default picker UI.
// options: [{ value, label, color? }]
export default function Select({ value, onChange, options, placeholder = 'Choose…', disabled }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="select-trigger"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
      >
        <span className="select-trigger-label">
          {current?.color && <span className="select-swatch" style={{ background: current.color }} />}
          {current ? current.label : <span className="muted">{placeholder}</span>}
        </span>
        <ChevronDown />
      </button>

      {open && (
        <div className="select-backdrop" onClick={() => setOpen(false)}>
          <div className="select-sheet" role="listbox" onClick={(e) => e.stopPropagation()}>
            <div className="select-grip">
              <span className="modal-handle" />
            </div>
            <div className="select-options">
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`select-option${o.value === value ? ' select-option--on' : ''}`}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.color && <span className="select-swatch" style={{ background: o.color }} />}
                  <span className="select-option-label">{o.label}</span>
                  {o.value === value && <CheckIcon />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="select-chevron">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="select-check">
      <path d="M4 12l5 5 11-11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
