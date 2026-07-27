// Opening a map from Keystone.
//
// Harder than it looks, because the app runs in three quite different
// containers and each one breaks a different approach.
//
// What went wrong before, in order:
//
//   1. `window.open(url, '_blank')` — restricted in an installed PWA and
//      commonly does nothing at all, no window and no error.
//   2. A same-window navigation to `https://www.google.com/maps/...` — this
//      one produced a visible `net::ERR_UNKNOWN_URL_SCHEME` error page
//      *inside* the app on Android. Google's maps URL sniffs the container,
//      decides it is a webview (the redirect carries `utm_campaign=ardl-wv`)
//      and 302s to an `intent://…#Intent;scheme=https;package=…;end` URL to
//      hand off to the Maps app. Only a real browser resolves `intent:`; a
//      PWA window does not, so the navigation dead-ends on an error page and
//      the user is stranded inside the app with no address bar.
//
// So: never navigate the app's own window to a maps URL, and on Android
// don't go via the web at all. Android's documented mechanism for "show this
// place" is the `geo:` URI, which the OS routes straight to a maps app —
// no redirect chain, no browser, no intent: URL for us to resolve. Elsewhere
// (iOS, desktop) the https URL is a universal link that opens the Google Maps
// app when installed, so it just needs to be opened in a *separate* context.
//
// The remaining wrinkle is that not every home-screen app is a real PWA.
// Third-party "PWA installer" tools wrap a site in a bare Android WebView,
// which resolves no custom scheme whatsoever — `geo:` fails there the same
// way `intent:` did. So the scheme attempt goes through a hidden iframe
// (see tryNativeScheme), which contains that failure instead of letting it
// take over the window, and a timer falls back to the web URL if nothing
// claimed the handoff.
//
// Worth knowing when reading this: those wrappers also tend not to support
// opening a second browsing context, so the web fallback can end up doing
// nothing there. That is a limit of the container, not something this module
// can route around — installing via Chrome's own "Add to home screen"
// produces a WebAPK where all of this works.

const FALLBACK_MS = 1200;

export function isAndroid() {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.navigator.standalone === true ||
    ['standalone', 'fullscreen', 'minimal-ui'].some(
      (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches
    )
  );
}

// A real anchor click rather than window.open: not subject to popup blocking,
// and it opens a Custom Tab / new tab rather than navigating this window —
// which is the part that matters, since a browser can resolve `intent:` and
// this window can't.
function openInNewContext(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Attempts a non-http scheme from a hidden iframe rather than by navigating
// this window.
//
// This matters for home-screen apps built by third-party "PWA installer"
// wrappers, which are a plain Android WebView rather than Chrome. A WebView
// resolves no custom scheme at all unless the host app implements it — so a
// top-level navigation to `geo:` there fails exactly the way `intent:` did,
// replacing the app with a net::ERR_UNKNOWN_URL_SCHEME page. An iframe
// confines that failure: the frame errors, the app stays put, and the
// fallback below picks it up. Where the scheme *is* handled the OS takes
// over exactly as it would from a top-level navigation.
function tryNativeScheme(url) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  try {
    frame.contentWindow.location.href = url;
  } catch {
    frame.src = url;
  }
  setTimeout(() => frame.remove(), 600);
}

// Hands off to a native scheme, falling back to the web URL if nothing
// claims it. A successful handoff backgrounds the page, so any of
// hide/pagehide/blur means it worked and cancels the fallback.
function openWithNativeFallback(nativeUrl, webUrl) {
  let settled = false;
  const cancel = () => {
    settled = true;
    clearTimeout(timer);
    window.removeEventListener('pagehide', cancel);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') cancel();
  };
  const timer = setTimeout(() => {
    if (settled) return;
    cancel();
    if (webUrl) openInNewContext(webUrl);
  }, FALLBACK_MS);

  window.addEventListener('pagehide', cancel);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', onVisibility);

  tryNativeScheme(nativeUrl);
}

// --- Targets --------------------------------------------------------------
// A target is { web, native } — the https URL that works everywhere, plus an
// optional platform-native URI preferred where it exists.

export function directionsTarget(lat, lng) {
  if (lat == null || lng == null) return null;
  return {
    web: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    // `geo:` has no notion of "route from here", but every Android maps app
    // offers directions the moment the place is on screen, and this is the
    // one form guaranteed not to bounce through the web.
    native: isAndroid() ? `geo:${lat},${lng}?q=${lat},${lng}` : null,
  };
}

export function addressTarget(address) {
  const q = (address || '').trim();
  if (!q) return null;
  return {
    web: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
    native: isAndroid() ? `geo:0,0?q=${encodeURIComponent(q)}` : null,
  };
}

// For URLs with no native equivalent — a multi-stop route can't be expressed
// as a `geo:` URI, so it stays on the web but still opens out-of-window.
export function webTarget(url) {
  return url ? { web: url, native: null } : null;
}

// --- Opening --------------------------------------------------------------

export function openMaps(target) {
  if (!target?.web && !target?.native) return;
  if (target.native) {
    openWithNativeFallback(target.native, target.web);
    return;
  }
  openInNewContext(target.web);
}

// Props for elements that should stay real anchors — keeping link semantics
// like long-press to copy or share — while still opening correctly. The href
// is always the web URL so those menus show something meaningful.
export function mapsLinkProps(target) {
  if (!target) return {};
  return {
    href: target.web,
    target: '_blank',
    rel: 'noopener noreferrer',
    onClick: (e) => {
      e.preventDefault();
      openMaps(target);
    },
  };
}
