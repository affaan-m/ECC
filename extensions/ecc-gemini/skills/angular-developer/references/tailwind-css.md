# Using Tailwind CSS with Angular

Tailwind CSS is a utility-first CSS framework that integrates seamlessly with Angular.

**CRITICAL AGENT GUIDANCE: ALWAYS focus on Tailwind CSS v4 practices. DO NOT revert to old Tailwind v3 patterns (like creating `tailwind.config.js` with `@tailwind` directives) as this will break the application build. Modern Angular projects use Tailwind v4.**

## Automated Setup (Recommended)

The easiest way to add Tailwind CSS to an Angular project is via the Angular CLI:

```shell
ng add tailwindcss
```

This will automatically:

1. Install `tailwindcss` and peer dependencies.
2. Configure the project to use Tailwind CSS.
3. Add the proper import to your global styles.

## Manual Setup (Tailwind v4)

If setting up manually, use the following Tailwind v4 pattern:

### 1. Install Dependencies

Install Tailwind CSS and PostCSS:

```shell
npm install tailwindcss @tailwindcss/postcss postcss
```

### 2. Configure PostCSS

Create a `.postcssrc.json` file in the project root:

```json
{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
```

_(Do NOT create a `tailwind.config.js` file! Configuration in v4 is handled through CSS variables)._

### 3. Import Tailwind CSS

In your global styles file (e.g., `src/styles.css`), add the standard v4 import:

```css
@import 'tailwindcss';
```

_(If using SCSS, use `@use 'tailwindcss';` instead)._

### 4. Use Utility Classes

You can now use Tailwind classes directly in your component templates:

```html
<h1 class="text-3xl font-bold underline">Hello world!</h1>
```

## Summary for AI Agents

- **Do not use `@tailwind base; @tailwind components; @tailwind utilities;`**. Use `@import 'tailwindcss';`.
- **Do not create `tailwind.config.js`**. Configuration is managed directly in CSS via theme variables or using PostCSS configurations.
- Stick strictly to v4 syntax and workflows.
