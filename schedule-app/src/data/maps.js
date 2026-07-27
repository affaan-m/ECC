// Opening Google Maps from Keystone.
//
// The awkward part is not the URL, it's the *opening*. Installed to a home
// screen, the app runs in a standalone window with no browser chrome, and
// two things that work fine in a normal tab stop working there:
//
//   - `window.open(url, '_blank')` is heavily restricted in a standalone
//     iOS PWA and commonly does nothing at all — no new window, no error.
//     This was why the Directions buttons appeared dead.
//   - `target="_blank"` on an anchor is unreliable in the same context, and
//     where it does work it can strand the user in a chrome-less view with
//     no back button.
//
// What is reliable is a plain same-window navigation to an out-of-scope
// URL. The manifest scopes the app to its own origin, so navigating to
// google.com is out of scope, and the platform takes over: iOS hands off to
// Safari — or straight to the Google Maps app, since these are universal
// links — and Android opens a Custom Tab over the app. The PWA is left
// intact underneath in both cases, and all app state lives in localStorage
// anyway, so returning to it loses nothing.
//
// In an ordinary browser tab a real anchor click is still the better
// behaviour (keeps the app open in its own tab), so that path is unchanged.

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  // navigator.standalone is the iOS-specific flag; the media queries cover
  // Android/desktop installs, including the less common display modes.
  return (
    window.navigator.standalone === true ||
    ['standalone', 'fullscreen', 'minimal-ui'].some(
      (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches
    )
  );
}

export function openExternal(url) {
  if (!url) return;
  if (isStandalone()) {
    window.location.href = url;
    return;
  }
  // A real anchor click rather than window.open: it isn't subject to popup
  // blocking and doesn't need a popup permission.
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// For places that should stay a real <a> — keeping link semantics like
// long-press to copy or share — while still opening correctly when
// installed. Spread onto the element.
export function externalLinkProps(url) {
  return {
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    onClick: (e) => {
      if (!isStandalone()) return;
      e.preventDefault();
      window.location.href = url;
    },
  };
}

// --- URL builders ---------------------------------------------------------
// `api=1` is Google's documented, stable cross-platform Maps URL format; it
// resolves to the native app where one is installed and the web map
// otherwise.

export function directionsUrl(lat, lng) {
  if (lat == null || lng == null) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function addressSearchUrl(address) {
  const q = (address || '').trim();
  if (!q) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
