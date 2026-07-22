// Whether Clerk (and therefore real accounts/billing) is configured in this
// build. Components that call Clerk hooks must only mount when this is
// true — main.jsx only renders <ClerkProvider> under the same condition, so
// unconditionally calling useAuth()/useUser() would throw otherwise.
export const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
