---
name: ecc-accessibility
description: Implement or review keyboard navigation, accessible forms, dialogs, focus management, semantics, and ARIA in web interfaces.
---

# Web accessibility

Use native interactive elements and semantic HTML first. Check accessible names,
visible focus, tab order, keyboard interactions, validation messages, and focus
restoration after dialogs close. ARIA does not add keyboard behavior.

Test the actual interaction flow using available browser tools and existing
component tests. Automated axe checks supplement keyboard and screen reader
inspection; report which checks were performed.
For concrete forms, menus, dialogs, tooltips, and test examples, read
[accessibility patterns](references/patterns.md). The React examples also describe
DOM requirements applicable to Vue and plain JavaScript.
