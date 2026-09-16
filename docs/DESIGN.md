# Design system

The look is not invented here. It is ported from the approved design file at
[`design/emir-crm-design.html`](../design/emir-crm-design.html), which is the
single source of truth for colour, spacing, radius, shadow, blur, motion and
chart styling. When this document and that file disagree, the design file wins.

The design file is a **visual reference only**. Every number a screen shows must
come from the database.

## Where it lives

```
web/src/styles/
  index.css        the one import; pulls in the four below, in this order
  tokens.css       :root custom properties, dark overrides, reduce-glass
  base.css         reset, page background, the drifting blobs, focus ring
  components.css   login, shell, dashboard, pipeline, inbox, drawer, tables
  animations.css   keyframes, entrance motion, the reduce-motion switches
  books.css        Emir Books — parked, not imported, not built

web/src/design/
  index.ts         the barrel every screen imports from
  AppShell.tsx     sidebar, top bar, mobile bottom bar
  Icon.tsx         bundled Lucide, keyed by the design's own names
  CountUp.tsx      animated headline numbers
  theme.ts         light / dark / system, "Reduce glass effect", reduced motion
  gallery.tsx      the dev-only gallery page (never bundled)
  charts/
    geometry.ts    smooth(), the design's curve maths
    ChartDefs.tsx  the gradient fills the charts paint with
    Spark.tsx  AreaChart.tsx  Donut.tsx  Gauge.tsx  Funnel.tsx  Heat.tsx
```

**Order matters.** `components.css` re-styles rules declared earlier in the same
file — that is how the approved design cascades — and `animations.css` layers
entrance motion on top of the component rules. Do not reorder the imports, and
do not fold the two `:root` blocks in `tokens.css` together.

## Seeing it

```bash
npm run dev:web        # then open http://localhost:5173/design-system.html
```

The gallery renders the shell, every chart, the theme controls and all 109 icons
on one page. It is served in development only: Vite serves every `.html` in the
project root but bundles only the entries named in the build config, and the
gallery is deliberately not one of them. It never ships.

## Porting a screen from the design file

The markup is meant to transfer almost literally.

| In `emir-crm-design.html` | Here |
|---|---|
| `<i data-lucide="kanban"></i>` | `<Icon name="kanban" />` |
| `<b data-count="770">0</b>` | `<CountUp value={770} />` |
| `class="kpi span-3 rise" style="--i:2"` | unchanged — the CSS is the same |
| `<button data-view="inbox">` in `.nav` | `<NavLink to="/inbox">`, same styling |
| `areaChart(30)` | `<AreaChart points={…} />` |
| `<svg data-spark="12,18,15">` | `<Spark values={[12, 18, 15]} />` |

Class names, the 12-column `.dash` grid, the `--i` entrance stagger and the
`--c` stage-colour variable all work exactly as they do in the design file.

## Deliberate differences from the design file

Four, and only four:

1. **Icons are bundled, not loaded from a CDN.** The design pulls Lucide from
   unpkg. A blocked icon host once rendered every icon in this app as raw text,
   and agents use it on phones on patchy networks, so the icons ship in the
   bundle. Tree-shaking keeps it to the 109 actually used.
2. **Nav items are links, not buttons.** An agent should be able to copy the URL
   of a board or middle-click a lead. `.nav a` and `.bottom-nav a` repeat the
   design's button rules verbatim, so they look identical.
3. **Chart gradients read `--primary`** instead of the hard-coded light-mode
   teal, so the fills follow the theme. Identical in light mode.
4. **RTL.** The design is left-to-right only. A `[dir="rtl"]` block mirrors the
   fixed shell — sidebar, drawer, timeline, message bubbles — for Arabic.

## Theme

Two independent settings, both per device rather than per account: an agent who
wants the glass off on an old phone should not get it off on a desktop too.

| Setting | Storage key | Attribute on `<html>` |
|---|---|---|
| Appearance | `emir.theme` | `data-theme="light" \| "dark"`, absent for system |
| Reduce glass effect | `emir.glass` | `data-glass="off"` |

"System" writes no `data-theme` at all, which is what lets
`@media (prefers-color-scheme: dark)` decide. Both are applied by a small inline
script in `index.html` before first paint, which is what stops the light-then-dark
flash; `theme.ts` owns the keys and the same script exists in the gallery page.

Reading the keys is wrapped in try/catch: private-mode Safari throws rather than
returning null, and an unreadable preference must never stop the app rendering.

## Motion

Every animation is switched off by the two `prefers-reduced-motion` queries at
the bottom of `animations.css`, and the components that animate in JavaScript —
`CountUp`, `Donut`, `Gauge`, `Funnel` — check `usePrefersReducedMotion()` and
jump to their final state instead. Charts still draw; they just arrive already
drawn.

## The CRM | Books switcher

Not built. Books is out of scope until the owner asks for it. The sidebar
reserves the switcher's footprint with `.app-switch-slot` so the proportions are
already final, and the design's own `.app-switch` rules are in `components.css`
ready for the buttons. The Books colour and layout CSS is parked verbatim in
`books.css`, imported by nothing.
