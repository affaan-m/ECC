# Re-render Optimization (MEDIUM)

Re-render rules for the `react-performance` skill. Load this when a component re-renders on high-frequency state updates, when props fan out to many children, or when `memo` is not behaving as expected.

## Don't subscribe to state used only in callbacks

```tsx
// INCORRECT - re-renders every time count changes
const count = useStore((s) => s.count);
const handler = () => doSomething(count);

// CORRECT - read once on call
const handler = () => {
  const count = useStore.getState().count;
  doSomething(count);
};
```

## Extract expensive work into memoized components

```tsx
// CORRECT - child re-renders only when `items` changes
const Heavy = memo(function Heavy({ items }: { items: Item[] }) {
  return <Chart data={transform(items)} />;
});
```

## Hoist default non-primitive props

```tsx
// INCORRECT - new array each render breaks memo
<List items={items ?? []} />

// CORRECT
const EMPTY: Item[] = [];
<List items={items ?? EMPTY} />
```

## Primitive dependencies in effects

```tsx
// INCORRECT - new object identity every render
useEffect(() => {}, [{ id, name }]);

// CORRECT - primitives
useEffect(() => {}, [id, name]);
```

## Subscribe to derived booleans, not raw values

```tsx
// INCORRECT - re-renders for any cart change
const cart = useStore((s) => s.cart);
const hasItems = cart.length > 0;

// CORRECT - re-renders only when emptiness flips
const hasItems = useStore((s) => s.cart.length > 0);
```

## Derive during render, never via `useEffect`

```tsx
// INCORRECT
const [full, setFull] = useState("");
useEffect(() => setFull(`${first} ${last}`), [first, last]);

// CORRECT
const full = `${first} ${last}`;
```

## Functional `setState` for stable callbacks

```tsx
// CORRECT
const increment = useCallback(() => setCount((c) => c + 1), []);
```

## Lazy state initializer for expensive values

```tsx
const [tree] = useState(() => parseTree(largeInput));
```

## Avoid memo for simple primitives

`useMemo(() => x + 1, [x])` is overhead. Memo earns its keep on object identity and expensive computation.

## Split hooks with independent deps

```tsx
// INCORRECT - both selectors re-run if either source changes
const { a, b } = useSomething(source1, source2);

// CORRECT
const a = useA(source1);
const b = useB(source2);
```

## Move interaction logic into event handlers

Event handlers run only on the user action. `useEffect` re-runs whenever deps change.

## `startTransition` for non-urgent updates

```tsx
const [pending, startTransition] = useTransition();
startTransition(() => setFilters(newFilters));
```

## `useDeferredValue` for expensive renders

```tsx
const deferredQuery = useDeferredValue(query);
const results = useMemo(() => expensiveSearch(deferredQuery), [deferredQuery]);
```

## `useRef` for transient frequent values

For values that change often but should not trigger re-render (timestamps, last-key, accumulators).

## Don't define components inside components

```tsx
// INCORRECT - Inner is a new component on every Outer render
function Outer() {
  const Inner = () => <span />;
  return <Inner />;
}
```

Each render makes a new `Inner` type, defeating reconciliation and unmounting children.
