import { useRef, useState } from 'react';
import { fileToAvatarDataUrl } from '../data/image.js';
import { initials } from '../data/helpers.js';

// Renders a contact's photo if they have one, otherwise their initials on a
// color chip (their status color, or a fallback).
export function Avatar({ name, photo, color, size = 'md' }) {
  const cls = `avatar${size === 'lg' ? ' avatar--lg' : size === 'sm' ? ' avatar--sm' : ''}`;
  if (photo) {
    return <img className={cls} src={photo} alt="" />;
  }
  return (
    <span className={cls} style={{ background: color || 'var(--muted)' }}>
      {initials(name)}
    </span>
  );
}

// A tappable version used in add/edit forms: shows the current avatar (or
// initials) with a small camera badge; tapping opens the phone's photo/camera
// picker. Images are downscaled client-side before being handed back.
export function AvatarPicker({ name, photo, color, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = () => inputRef.current?.click();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      onChange(dataUrl);
    } catch {
      alert('Could not use that photo. Try a different one.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avatar-picker">
      <button type="button" className="avatar-picker-btn" onClick={pick} disabled={busy}>
        <Avatar name={name} photo={photo} color={color} size="lg" />
        <span className="avatar-picker-badge">{busy ? '…' : <CameraIcon />}</span>
      </button>
      {photo && (
        <button type="button" className="avatar-picker-remove" onClick={() => onChange('')}>
          Remove photo
        </button>
      )}
      {/* No `capture` attribute. With it, mobile browsers jump straight to
          the camera and never offer the photo library — so adding a picture
          of someone meant taking a new one on the spot, which for a contact
          is almost never what you want. Without it the OS shows its normal
          picker: Photo Library, Take Photo, or Browse. */}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleFile} />
    </div>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M4 8h3l2-2h6l2 2h3v11H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13.5" r="3.4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
