---
name: ecc-vue
description: Build and review Vue 3 components, composables, Pinia state, Vue Router, and Nuxt SSR.
---

# Vue and Nuxt

Inspect the installed Vue/Nuxt versions and existing component conventions.
Prefer typed Composition API and `<script setup lang="ts">` for new Vue 3
components when consistent with the project. Keep state ownership and side
effects explicit; dispose subscriptions, timers, and event listeners.

Preserve reactivity across destructuring and prop updates. Scope request state
to each SSR request, keep server secrets out of client bundles, and avoid browser
globals during server rendering. Validate loading, error, and empty states.

For reactivity, component contracts, composables, Pinia, routing, or component
tests, read [Vue patterns](references/vue.md).
For Nuxt app structure, server handlers, auto-imports, or SSR behavior, read
[Nuxt patterns](references/nuxt.md) and match the installed Nuxt major version.
