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
js/standards.js       real-world data (Strength Level, Running Level, Coggan) + percentile math
js/ranks.js           per-exercise real-world rank from history + body profile (best ever, never drops)
js/achievements.js    achievements, feats, per-exercise levels (pure functions, derived from history)
js/themes.js          progression themes: names, icons, tier names/colors, wording (no mechanics)
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
3. Best set below `repMin` → same targets, plus a "Hold" hint.
4. Below `repMin` at the **same weight two sessions in a row** → **Deload**: ~10% lighter (nearest step, always at least one step down), all sets target `repMin`.
5. No history → no weight suggestion; target reps = `repMin`.

The suggestion pre-fills the set inputs, and you can overwrite anything.
Also tracked per exercise: heaviest weight, best estimated 1RM (Epley: `w × (1 + r/30)`), and an e1RM trend chart.

## Cardio
Cardio exercises have `kind: "cardio"`, a `cardio` type (run / bike / walk / stairs / elliptical / other), `durMin`/`durMax` (minutes), `intLabel` (km/h, level, incline %…) and `intStep`.
A bout is `{ min, int, km, watts }`. Running distance is derived from speed × time when km is blank.
**Cardio double progression** (`Progression.suggestCardio`): each session ~10% longer at the same intensity, up to `durMax`. Then intensity goes up by `intStep` and duration drops back to `durMin`.
PRs and relative levels use `Progression.cardioScore`: 5K-equivalent speed for runs, minutes × intensity for everything else.
Built-ins: Treadmill Run, Stationary Bike, Incline Treadmill Walk, Stair Climber, Elliptical. They form one swap group.

## Real-world ranks (`js/standards.js`, `js/ranks.js`)
Tiers mean "better than X% of real people", with the theme naming them: tier 1 everyone, 2 top 80%, 3 top 50%, 4 top 20%, 5 top 5%, 6 top 1%.
- **Lifts**: Strength Level standards (5th/20th/50th/80th/95th percentile of ~46M logged lifts), stored as a few bodyweight rows per lift and sex. Between rows: log-log interpolation. Between percentiles: linear in z (normal) units, extrapolated above the 95th. Units are kg 1RM (Epley from sets ≤15 reps), kg of ONE dumbbell, or bodyweight reps. Built-ins map to a standard in `baseline.js` (`STD`); custom strength exercises can pick one ("rank as…").
- **Running**: Running Level 5K times by age and sex, same percentiles. Any run ≥1.6 km becomes a 5K-equivalent time via Riegel (`t × (5/d)^1.06`).
- **Bike**: no reliable percentile data, so FTP (avg watts of a ≥20 min ride × 0.95) ÷ bodyweight is graded on Allen & Coggan's categories (Untrained → Superior = tiers 1–5).
- Walk / stairs / elliptical: no standard, so no rank. They still get progression, levels, PRs and badges.
- **Never goes down**: a rank is the best result ever, judged at the bodyweight on that workout day (`weighIns`). Overall strength = mean percentile of your best 3 lifts, so a new weak lift can't lower it. Missing exercises or weeks costs nothing; only the streak counter resets.
- Strength Level users are gym-goers who log lifts, so percentiles compare you to them, not to everyone. The Awards page says so.

## Body stats (`settings.profile`, `weighIns`)
`profile = { sex, born, heightCm, activity, goal }` (birth year, so age stays current), and `weighIns = [{ day, kg }]`. Saving the body sheet logs today's weigh-in.
Calculator: BMI (WHO bands); BMR via Mifflin-St Jeor; × activity factor (1.2–1.9) = maintenance; goal ±275/550 kcal (≈0.25/0.5 kg/week); floor max(BMR, 1500 m / 1200 f).
Macros: protein 1.8 g/kg (BMI-25 weight if BMI ≥ 30), fat ≥ 25% of kcal (min 0.6 g/kg), carbs the rest. "Use as my daily goals" writes `settings.goals`.

## Achievements (`js/achievements.js`)
Computed from finished sessions every time, never stored, so they work retroactively and survive export/import.
They only read fields **every** exercise has (weight, reps, `repMax`, `sets`), so custom exercises count exactly like built-in ones.
Progress is always relative to your own first session on that exercise, never absolute kilos, so the kg/lb label doesn't matter.
- **Strength score** per set: Epley e1RM. Bodyweight sets (w = 0) use `1 + r/30` (bodyweight = 1). Weighted and bodyweight series are tracked separately.
- **Exercise level**: +1 level for every 5% the best score beats the first session's.
- **Tiered families** (Bronze → Legend): workouts, weekly streak (2+ training days/week), PRs, top-of-range clears, new top weights, best % gain, sets, exercises tried, exercises at level 5.
- **Feats**: Clean Sweep (3+ PRs in one workout), Comeback (14+ day break), Bread & Butter (20 sessions of one exercise).
- "Top of the range" uses the exercise's *current* rep range and set count, so editing them changes past counts.
**Themes** (`js/themes.js`, chosen in Settings, saved as `settings.theme`, included in backups): *Iron Classic* (default), *Greek Myth*, *Roman Legion*, *Olympic Path*. Only owner-approved themes are added. A theme only renames and re-skins; thresholds and rules are shared, so switching never changes what's earned. Add a theme by copying one object with a new `id`.
Finishing a workout diffs before/after and shows a sheet with unlocks, level-ups and PRs.

## Workout flow (mix of routines + freestyle)
Start from a routine (pre-loads its exercises) **or** start empty. Add or remove exercises at any time.
Each exercise card shows: *Last time* → *Today's target* → set rows (weight, reps, ✓).
The in-progress session is saved on every change, so closing the app loses nothing.
- **Swap**: exercises with substitutes (built-in swap groups) show "⇄ Swap for …" chips. Swapping replaces the card with the substitute's own targets; logged sets on the old one are dropped after a confirm.
- **Rest timer**: ticking ✓ starts a countdown (`settings.rest = { on, sec }`, default 90 s; per-exercise `rest` overrides, 0 = none). It lives on `active.rest = { endsAt, total, done }`, so it survives reloads. At zero it vibrates (Android only; iOS has no vibration API) and beeps. It hides 30 s after ending. Timers can't fire while the phone is locked, which is why the screen lock exists.
- **Screen lock**: `navigator.wakeLock` keeps the screen on while a workout is active (`settings.wakeLock`, default on). It's re-requested whenever the app becomes visible.
- **Edit a finished workout** (History → Sessions → Edit): date, weights, reps, add/remove sets or exercises. It works on a draft copy, and Save validates it and re-sorts sessions by date. Awards and levels recompute on their own.

## Food flow (manual + saved foods)
Day view: totals vs goals (kcal/P/C/F bars) and a list of entries.
Add = search saved foods (most recent first) → quantity → log. Or create a new food (saved for reuse), or quick-add raw numbers.
Re-logging: "Copy yesterday / previous day" fills the viewed day; on a past day, "Copy this day to today" and a per-entry ↻ (log again today). Copies are new entries with the same macro snapshot.

## Out of scope (on purpose)
Accounts, sync, food database or barcode lookup, plate math, charts beyond a sparkline.
