<p align="center">
<a href="./README.zh.md">🇨🇳 中文</a> &nbsp;|&nbsp; <a href="./README.md"><b>🇺🇸 English</b></a>
</p>

# Workout Block

An Obsidian workout-tracking plugin built on **"ultimate flexibility."** It imposes no training system on you — *you* define the workout types, log *any* data you want, and run *arbitrary* derived calculations on your log fields. Training plans, muscle management, and muscle heatmaps are all configurable to fit your own style. Everything is rendered as **code blocks**, with the rendering and data layers cleanly decoupled. Data lives as plain text (CSV / JSON) inside your vault, directly queryable by tools like Dataview.

> **Core proposition**: No "fixed fields," no "standard exercise library," no "official templates." The plugin only provides an endlessly customizable skeleton — how you use it is entirely up to you.

> Plugin ID: `workout-block` ｜ Minimum Obsidian version: `1.5.0` ｜ License: MIT ｜ Languages: 中文 / English

---

## 🧭 Design Philosophy: Everything Is Customizable

Most training apps hard-code fields, exercises, and plans, forcing you to adapt to them. This plugin does the opposite — it gives the "definition power" back to you:

| What you decide | How you decide | Docs / Code |
|------------|----------|-----------|
| Which **workout types** exist | Build freely — e.g. add or remove "Strength / Cardio / Bodyweight / Agility / Climbing" at will | Logging §5 |
| What **fields** each type logs | Any number, any combination (number / duration / text / select) — no system constraints | Same |
| Field **units** | Weight auto-converts kg/lb, or free-text units (reps / km / floors / laps…) | Same |
| **Derived data** from log fields | Configure "data stats" just like workout types — guided builder or expression `sum(reps*weight)` | Stats design |
| How **training plans** are laid out | Custom target volume per exercise and per set; run on specific dates or weekly weekdays | Plan design |
| How **muscles** are managed | Any granularity: one muscle can map to 1 or N anatomy paths | Muscle design |
| What the **heatmap** draws | Per-muscle metric / time window / color tiers on a medical-grade anatomy figure | Same |

The modules below go into detail.

---

## ✨ Features

### 1. Fully Custom Workout Types — You Define What You Train

Workout types (e.g. "Strength," "Cardio," "Bodyweight") are only seed defaults. **You can create any type** and configure the fields it contains. The system does **not** assume "a type must have certain fields" — the count, control, and unit of fields are entirely your call.

- Supports **4 input controls** in any combination: `number` (numeric) / `duration` (h·m·s, stored as seconds) / `text` / `select` (dropdown with custom options).
- Each type needs at least 1 field; add or remove freely.
- Editing a type instantly changes every "new log / record" entry UI (fields are dynamically rendered from the type's `fields`).

**Custom example**: Create an "Agility" type with fields `sets` (number) + `distance` (number, unit "km") + `rest between sets` (select: 30s / 60s / 90s). For strength, you could have just `weight` + `reps`. No limits.

### 2. Log Any Training Data You Want — Freedom Down to "Each Set"

The smallest log granularity is **"one set"** (e.g. "Bench press 60kg × 8 reps" = one CSV row). The fields you fill in are **entirely determined by the selected workout type**, so you can log as many kinds of data as you have defined types and fields.

- **Last-value memory**: entering the next set auto-fills the previous value for that exercise, saving re-typing (toggleable in settings).
- **Fuzzy match**: exercise search supports substring matching — type a fragment and hit it.
- All data lands as plain text; fields are stored as JSON in the `fields` column, decoupling table structure from type definitions — adding types / fields never breaks historical logs.

### 3. Arbitrary Derived Calculations on Log Fields — Compute the Metrics You Care About

The built-in "total sets" is just one ordinary, pre-seeded stat. You can delete it and define your own derived metrics.

- **Dual-mode formulas**:
  - Guided builder: sum `sum` / sum-of-products `Σ(a×b)` / average·max·min / count `count` — just click to pick.
  - Free expressions (advanced): write directly `sum(reps * weight)`, `avg(weight)`, `max(weight)`, etc.
- **Link to workout types**: a stat can link to one or more types and only appears in those types' code blocks (e.g. "total volume" links to both Strength and Bodyweight).
- **Safe**: a sandboxed evaluator disables `eval` / `Function`, uses a function whitelist + field references + arithmetic, validates syntax and legality before saving, and blocks illegal formulas.
- Stat results are **computed at render time** — never written back to CSV, never polluting raw data.

### 4. Highly Flexible Training Plans — Schedule Your Own Way

A training plan isn't boxed in by a template; it's a fully configurable plan instance:

- **Per-set target volume**: each exercise, each set can preset a different target field value (since fields are yours, each set may differ).
- **Flexible schedule**: a specific day, or an ISO weekday loop like "every Mon / Wed / Fri."
- **Build plans from schemes**: scan notes containing `workout-plan` code blocks as sources and merge exercises in one click; also supports manually adding items outside the scheme, and adding/removing any training set individually.
- **Note-as-scheme**: a note with a `workout-plan` code block is itself a training scheme — no extra entity needed.
- **Completion state persisted independently**: tick "done" per set inside the code block to write the record; completion state lives in config, independent of training logs — **done means done, with no daily / weekly reset**, and deleting logs doesn't affect completion.

### 5. Muscle Management at Any Granularity — From "One Big Shoulder" to "Front/Middle/Rear Delts"

The relationship between muscles and the body SVG is a configurable mapping of **1 muscle → N SVG paths**, with granularity set by you:

- A beginner wants just "shoulders" as one block; a coach wants to color "anterior / middle / posterior deltoid" separately — the same plugin supports both.
- **First-run guided 3-tier import** (just an initial config, not a locked-in "mode"):
  - **Default**: 13 base muscles mapped to all anatomy paths by fitness group (most complete, recommended).
  - **Lean**: each muscle maps only its representative main path, for a cleaner chart.
  - **Manual**: mappings left empty for you to tick one by one.
- After import, add/remove mappings anytime in the edit popup — "change whenever you want, never held hostage by presets."
- Bilingual muscle catalog (Chinese / English anatomical names) with **143** mappable paths, plus a search box to handle the scale.

### 6. Medical-Grade Muscle Heatmap — See Your Body's Strengths & Weaknesses

Renders full-body muscle load based on **complete front / back human anatomy SVGs** (medical anatomical naming, from flutter-body-atlas, CC BY 4.0):

- One-click front / back switch; both SVGs are inlined, so switching only changes display, not recomputation.
- Colors muscles by training volume (default "reps," changeable per muscle); color tiers are configurable per muscle (tiers ≤ 99, each tier's color and threshold are custom hex).
- **Three-level fallback**: muscle-level → code-block-level (`metric` / `range` params) → global default; each muscle can individually set "what metric, over what window."
- Weighted coloring: primary exercise weight 1.0, auxiliary 0.5, accumulated; absolute-threshold coloring (not whole-image normalization); when multiple muscles hit the same path, the highest contributor decides the tier.
- Computed and colored only when scrolled into view (lazy render), low main-thread cost.

### 7. Code-Block Presentation, Highly Decoupled — Content Lives in Your Notes

The plugin takes over rendering of four fenced code-block types — just write them in your notes; rendering and data layers are fully separated:

| Code block | View |
|--------|------|
| `workout-log` | Single-exercise history table + grouped aggregate stats |
| `workout-day` | That day's training overview (exercises / stat values / primary·aux muscles / scheme) |
| `workout-plan` | Training-plan completion panel (tick per set) |
| `workout-heatmap` | Full-body muscle-load heatmap (front/back switch) |

- **Extensible registry**: internally maintains a code-block type registry; adding a new code block = write a handler and `registerCodeBlock`, **no changes to existing logic needed**.
- **Precise re-render**: on data change, only re-draws code blocks containing that exercise (`rerenderBlocksForExercise`), avoiding full reloads; only language switch / external file edits trigger a global refresh.
- Works in both preview and reading mode, with scoped styles that don't pollute the vault globally.

### 8. Bilingual (中文 / English) & Plain-Text Data

- UI follows Obsidian's language; switching re-renders instantly, with code-block tables / heatmap text / duration tokens all clean and residue-free.
- All data lives in in-vault text files (CSV + JSON), no proprietary binary format — goes into Git, backs up easily, and is directly queryable by tools like Dataview.

---

## 📦 Installation

### Method 1: BRAT (recommended, supports auto-update)

1. Install **BRAT** from the Obsidian community plugin marketplace.
2. Open BRAT settings → `Add a beta plugin`, and enter this repository's URL.
3. Enable **Workout Block** under "Community plugins."

### Method 2: Manual install

1. Download `main.js` and `manifest.json` from Releases or the repo root.
2. Place them in your vault: `<vault>/.obsidian/plugins/workout-block/`.
3. Enable the plugin under "Community plugins."

> On first launch, default workout types, muscles, and stats are written automatically — the heatmap works out of the box, no manual init needed.

---

## 🚀 Quick Start

After enabling the plugin:

- Click the **dumbbell icon** in the left ribbon, or open the command palette (`Ctrl/Cmd + P`) and search "Log a set" to enter a training entry.
- To track an exercise long-term, write a `workout-log` code block in a note (see below).
- To customize the system: open Settings → Workout Block → the corresponding "Manage" popup to create workout types / exercises / plans / stats / muscle mappings.

---

## 📝 Code Blocks

The plugin takes over rendering of the four fenced code-block types below — just write them in your notes.

### `workout-log` — Training Log Table (history by exercise)

Shows training logs with interactive "log / edit / delete" actions; grouped-above shows that group's aggregate stats.

| Param | Description | Default |
|------|------|------|
| `exercise` | Show only the specified exercise (by name) | show all |
| `limit` / `number` | Max rows to show | 50 |
| `day` | Show only records from the last N days | — |
| `group_by` | `date` (by day) / `week` (year-week) | `date` |
| `sort` | `desc` / `asc` | `desc` |
| `show_add` | Whether to show the top "add record" button | `true` |

````markdown
```workout-log
exercise: Squat
limit: 20
```
````

### `workout-day` — That Day's Training Overview

Summarizes "what was trained" by day; columns: exercise / stat value / primary muscles / auxiliary muscles / training scheme.

| Param | Description |
|------|------|
| `day: 2026-07-12` | Query a specific date |
| `day: today` | Show today (live data, rolls with the date) |
| no `day` | Also shows today, and provides a "pin to today" button that writes the date back |

````markdown
```workout-day
day: 2026-07-12
```
````

### `workout-heatmap` — Muscle Heatmap

Renders the full-body muscle figure, colored by training volume. Above the code block is a **front / back** switch; the color tiers (default 4: blue / green / orange / red) — tier count, each tier's color and threshold — are all customizable per muscle in "Muscle management."

| Param | Description | Default |
|------|------|------|
| `metric` | Reference a stats config (e.g. "reps") | global default (reps) |
| `range` | `7d` / `30d` / `90d` / `all` / date range | global default (7d) |

````markdown
```workout-heatmap
metric: reps
range: 7d
```
````

### `workout-plan` — Training Plan Completion Panel

Tracks completion progress of a training scheme, ticking off sets one by one.

| Param | Description |
|------|------|
| `plan: Plan Name` | Specify which scheme to show; if omitted, shows a "select plan" dropdown that writes the name back to the code block on selection |

````markdown
```workout-plan
plan: Push Day A
```
````

---

## ⚙️ Settings & Data Management

In Settings (`Ctrl/Cmd + ,` → Workout Block) you can configure:

- **Workout types / exercises / muscles / stats / training plans**: all added/edited/removed in their corresponding "Manage" popups — this is the master switch for the plugin's "freedom."
- **Language**: 中文 / English.
- **Weight unit**: kg / lb (affects display and conversion of weight-type fields).
- **Last-value memory**: toggle.
- **Data directory**: where the training-log CSV is stored (vault root by default).
- **Compact & clean CSV**: deleting logs uses "soft delete" (immediately removed from UI, disk space reclaimed lazily); click this to truly compact the file and reclaim space.

### Data Storage Locations

| File | Content |
|------|------|
| `workout_logs.csv` | All training logs (plain CSV, easy Dataview querying) |
| `workout-config.json` | Config: workout types, exercises, muscles and their SVG mappings, stats, training plans |

Both datasets live inside the vault (data directory changeable in settings), both plain text, ready for Git or a quick backup.

---

## 🔧 Development

```bash
# Install dependencies
npm install

# Dev mode (watch changes, unminified)
npm run dev

# Production build (outputs root main.js)
npm run build

# Run tests
npm test

# Test coverage
npm run test:coverage
```

The build artifact is the root `main.js`, which together with `manifest.json` makes the plugin runnable.

### Tech Stack

- TypeScript + [esbuild](https://esbuild.github.io/) (bundling)
- [Vitest](https://vitest.dev/) + jsdom (unit testing)
- [papaparse](https://www.papaparse.com/) (CSV read/write)
- Obsidian API

---

## 📄 License

MIT — free to use, modify, and distribute. The repo root includes a `LICENSE` file (full MIT text) so GitHub auto-detects the license.

The bundled muscle SVG illustrations come from third parties, under **CC BY 4.0** (author Ryan Graves) and **BSD-3-Clause** (flutter-body-atlas, Kit G). Attribution and license details are in [THIRD-PARTY-NOTICES](./THIRD-PARTY-NOTICES).
