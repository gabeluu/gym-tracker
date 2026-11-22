# Gym Tracker — Architecture (MVP, single user)

## Decisions
| Area | Choice | Why |
|---|---|---|
| Platform | Installable PWA (phone home screen), works offline | Usable at the gym with no signal, no app store |
| Hosting | Any free static host (GitHub Pages / Netlify Drop) | No backend at all |
| Stack | Plain HTML + CSS + vanilla JS, no build step | Nothing to install, nothing to break |
| Storage | `localStorage` (one JSON blob) + Export/Import JSON | Data is tiny (~200 KB/year); backup = download a file |
| Units | kg by default, switchable to lb (label only) | |

## Files
```
index.html            shell + bottom tab bar
styles.css            mobile-first dark UI
js/store.js           load/save/export/import, ids, date helpers
js/progression.js     double-progression + PR/e1RM math (pure functions)
js/baseline.js        built-in exercise library + substitute groups + idempotent seed
js/app.js             views (Workout / Food / History / Settings) + event handling
manifest.webmanifest  PWA metadata
sw.js                 offline cache of the app shell
icons/                app icons
serve.ps1             local test server (Windows, no installs)
```

## Data model (`localStorage["gymtracker.v1"]`)
```js
{
  settings: { unit: "kg", goals: { kcal, p, c, f } },
  exercises: [{ id, name, repMin, repMax, sets, inc,      // per-exercise rule (user-editable)
                // built-in only (from js/baseline.js, refreshed on every start):
                is_baseline, name_ro, tier: "core"|"accessory", primary: [], secondary: [],
                pattern, equipment, substitutes: [exerciseId] }],
  routines:  [{ id, name, exerciseIds: [] }],              // templates, optional
  sessions:  [{ id, date, routineId|null, finishedAt,
                entries: [{ exerciseId, sets: [{ w, r, done }] }] }],
  active:    <session being logged, or null>,               // survives reloads
  foods:     [{ id, name, per: "serving"|"100g", kcal, p, c, f }],
  foodLog:   [{ id, day: "YYYY-MM-DD", foodId|null, name, qty, kcal, p, c, f }]
}
```
Food log entries store a snapshot of the macros, so editing a saved food never rewrites history.

## Built-in exercise library
`js/baseline.js` is the single source for built-in exercises. Each has a fixed id (`bl-…`) and an English `name` plus a Romanian `name_ro`. Search matches both names and ignores diacritics. Substitute groups are lists of ids.
`Baseline.seed(db)` runs on every app start, on import, and after "Erase all data". It is idempotent:
- It adds missing entries by id and never duplicates them.
- It refreshes only library-owned fields (`name_ro`, muscles, `substitutes`…).
- It never overwrites your own tuning (name, reps, sets, step) and never deletes anything.
- If you already have your own exercise with the same English name, that built-in entry is skipped, so you never get duplicates and your history stays where it is.

Built-in exercises can't be deleted. Adding to the library = append an entry with a new id. Never change an existing id.

## Progressive overload: double progression
Each exercise has a rep range `[repMin, repMax]`, a target set count, and a weight step `inc`.
Looking at the **last finished session** that included the exercise (completed sets only):

1. **Every** target set at the top weight reached `repMax` → **add `inc`**, all sets target `repMin`.
2. Otherwise → **same weight**, each set targets last time's reps **+1** (capped at `repMax`).
3. Best set below `repMin` → same targets, plus a "consider dropping weight" hint.
4. No history → no weight suggestion; target reps = `repMin`.

The suggestion pre-fills the set inputs, and you can overwrite anything.
Also tracked per exercise: heaviest weight, best estimated 1RM (Epley: `w × (1 + r/30)`), and an e1RM trend chart.

## Workout flow (mix of routines + freestyle)
Start from a routine (pre-loads its exercises) **or** start empty. Add or remove exercises at any time.
Each exercise card shows: *Last time* → *Today's target* → set rows (weight, reps, ✓).
The in-progress session is saved on every change, so closing the app loses nothing.

## Food flow (manual + saved foods)
Day view: totals vs goals (kcal/P/C/F bars) and a list of entries.
Add = search saved foods (most recent first) → quantity → log. Or create a new food (saved for reuse), or quick-add raw numbers.

## Out of scope (on purpose)
Accounts, sync, food database or barcode lookup, rest timers, plate math, charts beyond a sparkline.
