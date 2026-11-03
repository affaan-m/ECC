// Google sign-in through chrome.identity. The token is used as a bearer for
// generativelanguage.googleapis.com; it needs a Google Cloud project with the
// Generative Language API enabled (projectId is sent as x-goog-user-project).

const PLACEHOLDER = 'REPLACE_WITH';

export function oauthConfigured() {
  const id = chrome.runtime.getManifest()?.oauth2?.client_id || '';
  return Boolean(id) && !id.startsWith(PLACEHOLDER);
}

export async function getGoogleToken({ interactive = false } = {}) {
  if (!oauthConfigured()) {
    throw new Error('OAuth client_id not configured in manifest.json (see README, step "OAuth").');
  }
  const result = await chrome.identity.getAuthToken({ interactive });
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('Google sign-in did not return a token');
  return token;
}

export async function signOutGoogle() {
  try {
    const result = await chrome.identity.getAuthToken({ interactive: false });
    const token = typeof result === 'string' ? result : result?.token;
    if (token) {
      await chrome.identity.removeCachedAuthToken({ token });
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(token)}`).catch(() => {});
    }
  } catch {
    // Nothing cached: already signed out.
  }
}

// Resolves the auth the Gemini client should use, preferring OAuth when the
// manifest is configured and falling back to the API key silently.
export async function resolveGeminiAuth(settings, { interactive = false } = {}) {
  if (oauthConfigured()) {
    try {
      return { accessToken: await getGoogleToken({ interactive }), projectId: settings.projectId };
    } catch (err) {
      if (!settings.geminiApiKey) throw err;
    }
  }
  if (!settings.geminiApiKey) {
    throw new Error('Sign in with Google (options page) or paste a Gemini API key.');
  }
  return { apiKey: settings.geminiApiKey };
}
