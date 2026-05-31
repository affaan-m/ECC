---
name: motion-patterns
description: Production-ready animation patterns for React / Next.js — button, modal, toast, stagger, page transitions, exit animations, scroll, and layout — built on motion-foundations tokens and springs.
version: 1.0
tags: [motion, animation, ui-patterns]
category: frontend
author: jeff
---

# Motion Patterns

Copy-paste patterns for the most common UI animation needs.
Every pattern here is built on `motion-foundations` tokens and springs.
Do not define new duration or easing values here — import them.

## When to Activate

- Animating a button, card, modal, or toast notification
- Building list entrances with stagger
- Setting up page transitions in Next.js App Router
- Adding entrance or exit animations to conditional content
- Implementing scroll-reveal, scroll-linked progress, or sticky story sections
- Building expanding cards, accordions, or shared-element transitions

## Outputs

This skill produces:

- Accessible, SSR-safe animation for all standard UI components
- `AnimatePresence`-wrapped conditional renders with correct exit behavior
- Page transition wrapper component for Next.js App Router
- Scroll-reveal and scroll-linked patterns using `useScroll` + `useTransform`
- Layout animation patterns (`layout`, `layoutId`) for expanding and crossfading elements

## Principles

- Every pattern imports from `motion-foundations`. No raw numbers.
- Every conditional render is wrapped in `AnimatePresence` with a `key`.
- Exit animations are always defined alongside enter animations — never as an afterthought.
- `layout` is used only for small, isolated shifts. Large subtrees get explicit transforms.

## Rules

1. **Always wrap conditional renders in `AnimatePresence` with a `key`** on the direct child. Without a key, exit animations never fire.
2. **Always define `exit` when defining `initial` + `animate`.** An animation without an exit is incomplete.
3. **Use `mode="wait"` on page transitions.** Enter must not start until exit completes.
4. **Never use `layout` on subtrees with more than ~5 children or deeply nested DOM.** Use explicit `x`/`y` transforms instead.
5. **Stagger interval must stay between `0.05s` and `0.10s`.** Below feels mechanical; above feels sluggish.
6. **Modals must always include:** focus trap, Escape-key close, scroll lock, `role="dialog"`, `aria-modal="true"`.
7. **Scroll reveals use `viewport={{ once: true }}`.** Repeating on scroll-out is distracting, not informative.
8. **All token values are imported from `motion-foundations`.** No inline numbers.

## Decision Guidance

### Choosing the right pattern

| Situation | Pattern |
| ---------------------------------------- | ---------------------- |
| Element appears / disappears             | `AnimatePresence`      |
| List of items loading in sequence        | Stagger variants       |
| Navigating between routes                | Page transition wrapper|
| Element changes size in place            | `layout` prop          |
| Same element moves across page contexts  | `layoutId`             |
| Element enters when scrolled into view   | `whileInView`          |
| Value tied to scroll position            | `useScroll` + `useTransform` |

### When to use `mode="wait"` vs `mode="sync"`

| Mode | Use when |
| ------- | --------------------------------------- |
| `wait` | Page transitions, content swaps (one at a time) |
| `sync` | Stacked notifications, list items (overlap is fine) |
| `popLayout` | Items removed from a reflow list |

## Core Concepts

### AnimatePresence contract

Three things must always be true:

1. `AnimatePresence` wraps the conditional
2. The direct child has a `key`
3. The child has an `exit` prop

Miss any one of these and the exit animation silently fails.

### layout vs layoutId

- `layout` — animates the element's own size/position change in place
- `layoutId` — links two separate elements, crossfading between them across renders

Use `layout="position"` on text inside an expanding container to prevent text reflow from animating.

## Code Examples

### Button feedback

```tsx
"use client"
import { motion } from "motion/react"
import { springs, motionTokens } from "@/lib/motion-tokens"

<motion.button
  whileHover={{ scale: motionTokens.scale.pop }}
  whileTap={{ scale: motionTokens.scale.press }}
  transition={springs.snappy}
/>
```

### Stagger list

```tsx
"use client"
import { motion } from "motion/react"
import { motionTokens, springs } from "@/lib/motion-tokens"

const container = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,   // within the 0.05–0.10 rule
      delayChildren: 0.1,
    },
  },
}

const item = {
  hidden:  { opacity: 0, y: motionTokens.distance.md },
  visible: { opacity: 1, y: 0, transition: springs.gentle },
}

<motion.ul variants={container} initial="hidden" animate="visible">
  {items.map((i) => (
    <motion.li key={i.id} variants={item} />
  ))}
</motion.ul>
```

### Modal

```tsx
"use client"
import { motion, AnimatePresence } from "motion/react"
import { motionTokens, springs } from "@/lib/motion-tokens"

// Wrap at the call site:
// <AnimatePresence>{isOpen && <Modal key="modal" />}</AnimatePresence>

export function Modal({ onClose }: { onClose: () => void }) {
  return (
    <>
      {/* Overlay */}
      <motion.div
        className="fixed inset-0 bg-black/50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Panel — accessibility requirements: focus trap, Escape close,
          scroll lock, role="dialog", aria-modal="true" */}
      <motion.div
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 rounded-xl bg-white p-6"
        initial={{
          opacity: 0,
          scale: motionTokens.scale.press,
          y: motionTokens.distance.sm,
        }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{
          opacity: 0,
          scale: motionTokens.scale.press,
          y: motionTokens.distance.sm,
        }}
        transition={springs.gentle}
      />
    </>
  )
}
```

### Toast stack

```tsx
"use client"
import { motion, AnimatePresence } from "motion/react"
import { motionTokens, springs } from "@/lib/motion-tokens"

<AnimatePresence mode="sync">
  {toasts.map((t) => (
    <motion.div
      key={t.id}
      layout
      initial={{
        opacity: 0,
        x: motionTokens.distance.xl,
        scale: motionTokens.scale.subtle,
      }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{
        opacity: 0,
        x: motionTokens.distance.xl,
        scale: motionTokens.scale.subtle,
      }}
      transition={springs.snappy}
    />
  ))}
</AnimatePresence>
```

### Page transition (Next.js App Router)

```tsx
// components/page-transition.tsx
"use client"
import { motion, AnimatePresence } from "motion/react"
import { usePathname } from "next/navigation"
import { motionTokens } from "@/lib/motion-tokens"

const variants = {
  initial: { opacity: 0, y: motionTokens.distance.sm },
  enter:   { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -motionTokens.distance.sm },
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        variants={variants}
        initial="initial"
        animate="enter"
        exit="exit"
        transition={{
          duration: motionTokens.duration.normal,
          ease: motionTokens.easing.smooth,
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
```

### Scroll reveal

```tsx
"use client"
import { motion } from "motion/react"
import { motionTokens, springs } from "@/lib/motion-tokens"

<motion.div
  initial={{ opacity: 0, y: motionTokens.distance.lg }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, margin: "-80px" }}   // once: true — rule 7
  transition={{ duration: motionTokens.duration.slow, ease: motionTokens.easing.smooth }}
/>
```

### Scroll progress bar

```tsx
"use client"
import { motion, useScroll } from "motion/react"

export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  return (
    <motion.div
      className="fixed top-0 left-0 h-1 bg-indigo-500 origin-left w-full"
      style={{ scaleX: scrollYProgress }}
    />
  )
}
```

### Expanding card

```tsx
"use client"
import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { springs, motionTokens } from "@/lib/motion-tokens"

export function ExpandingCard({ title, body }: { title: string; body: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div layout onClick={() => setExpanded(!expanded)} className="cursor-pointer">
      {/* layout="position" prevents text reflow from animating */}
      <motion.h2 layout="position" className="font-semibold">
        {title}
      </motion.h2>

      <AnimatePresence>
        {expanded && (
          <motion.p
            key="body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.fast }}
          >
            {body}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
```

### Shared-element crossfade

```tsx
// Source context
<motion.img layoutId="hero-image" src={src} className="w-16 h-16 rounded" />

// Destination context (same layoutId — motion handles the transition)
<motion.img layoutId="hero-image" src={src} className="w-full rounded-xl" />
```

### Accordion

```tsx
<motion.div
  initial={false}
  animate={{ opacity: open ? 1 : 0, scaleY: open ? 1 : 0 }}
  style={{ transformOrigin: "top", overflow: "hidden" }}
  transition={{
    duration: motionTokens.duration.normal,
    ease: motionTokens.easing.smooth,
  }}
>
  {children}
</motion.div>
```

## End-to-End Example

A staggered list that enters on mount, handles conditional presence, and
respects reduced motion — combining tokens, springs, AnimatePresence, and
the accessibility hook from `motion-foundations`:

```tsx
"use client"
import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { motionTokens, springs } from "@/lib/motion-tokens"
import { useSafeMotion } from "@/hooks/use-reduced-motion"

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
}

function ListItem({ label, onRemove }: { label: string; onRemove: () => void }) {
  const safe = useSafeMotion(motionTokens.distance.sm)
  return (
    <motion.li
      variants={{
        hidden:  safe.initial,
        visible: safe.animate,
      }}
      exit={safe.exit}
      transition={springs.gentle}
      className="flex items-center justify-between p-3 rounded-lg bg-white shadow-sm"
    >
      <span>{label}</span>
      <button onClick={onRemove}>Remove</button>
    </motion.li>
  )
}

export function AnimatedList({ items, onRemove }: {
  items: { id: string; label: string }[]
  onRemove: (id: string) => void
}) {
  return (
    <motion.ul
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-2"
    >
      <AnimatePresence mode="popLayout">
        {items.map((item) => (
          <ListItem
            key={item.id}
            label={item.label}
            onRemove={() => onRemove(item.id)}
          />
        ))}
      </AnimatePresence>
    </motion.ul>
  )
}
```

## Constraints / Non-Goals

This skill does **not** cover:

- Token and spring definitions → see `motion-foundations`
- Drag interactions, swipe gestures, reorderable lists → see `motion-advanced`
- Text animations (word/character reveal, counters) → see `motion-advanced`
- SVG path drawing or morphing → see `motion-advanced`
- Custom animation hooks → see `motion-advanced`
- CSS-only transitions not using `motion/react`

## Anti-Patterns

| Anti-pattern | Rule violated | Fix |
| -------------------------------------------- | ------- | ------------------------------------------ |
| `AnimatePresence` child missing `key` | Rule 1 | Add stable `key` to the direct child |
| `initial` + `animate` without `exit` | Rule 2 | Always define all three together |
| Page transition without `mode="wait"` | Rule 3 | Add `mode="wait"` to `AnimatePresence` |
| `layout` on a 50-item list | Rule 4 | Use `mode="popLayout"` or explicit transforms |
| `staggerChildren: 0.2` on a 10-item list | Rule 5 | Cap at `0.08–0.10` |
| Modal without focus trap | Rule 6 | Add `focus-trap-react` or Radix Dialog |
| `whileInView` without `viewport={{ once: true }}` | Rule 7 | Repeating entrances distract, not inform |
| `transition={{ duration: 0.3 }}` inline | Rule 8 | Use `motionTokens.duration.normal` |

## Related Skills

- **`motion-foundations`** — defines all tokens, springs, the `useSafeMotion` hook, and SSR guards that every pattern here imports. Must be set up first.
- **`motion-advanced`** — extends these patterns with drag, gestures, SVG, text, custom hooks, and imperative sequencing. Does not redefine any patterns from this skill.
