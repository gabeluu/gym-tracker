// Built-in exercise library, seeded into every user's data on app start.
//
// To add an exercise: append an entry to EXERCISES with a new, unique "bl-…" id.
// NEVER change or reuse an existing id: seeding matches on id, and workout history points at it.
// `inc` is the default weight step in kg (it's converted when the app is set to lb).
(function () {
  const EXERCISES = [
    // ---- core ----
    { id: "bl-machine-chest-press", tier: "core", name: "Machine Chest Press", name_ro: "Împins la aparat pentru piept",
      primary: ["chest"], secondary: ["front delts", "triceps"], pattern: "horizontal push", equipment: "machine", repMin: 8, repMax: 12, inc: 2.5 },
    { id: "bl-lat-pulldown", tier: "core", name: "Lat Pulldown", name_ro: "Tracțiuni la helcometru",
      primary: ["lats"], secondary: ["biceps", "rear delts"], pattern: "vertical pull", equipment: "cable", repMin: 8, repMax: 12, inc: 2.5 },
    { id: "bl-45-back-extension", tier: "core", name: "45° Back Extension", name_ro: "Hiperextensii la banca de 45°",
      primary: ["glutes", "hamstrings"], secondary: ["lower back"], pattern: "hip hinge", equipment: "45° hyperextension bench (bodyweight, optional plate)", repMin: 10, repMax: 15, inc: 2.5 },
    { id: "bl-seated-leg-curl", tier: "core", name: "Seated Leg Curl", name_ro: "Flexii pentru femurali la aparat, din șezut",
      primary: ["hamstrings"], secondary: [], pattern: "knee flexion", equipment: "machine", repMin: 8, repMax: 12, inc: 2.5 },
    { id: "bl-seated-db-shoulder-press", tier: "core", name: "Seated Dumbbell Shoulder Press", name_ro: "Împins cu gantere pentru umeri, din șezut",
      primary: ["front delts"], secondary: ["triceps", "side delts"], pattern: "vertical push", equipment: "dumbbells + bench with back support", repMin: 8, repMax: 12, inc: 2 },

    // ---- accessory (add-ons) ----
    { id: "bl-goblet-squat", tier: "accessory", name: "Goblet Squat", name_ro: "Genuflexiuni cu ganteră (goblet)",
      primary: ["quads", "glutes"], secondary: [], pattern: "squat", equipment: "dumbbell", repMin: 8, repMax: 12, inc: 2 },
    { id: "bl-hack-squat", tier: "accessory", name: "Hack Squat", name_ro: "Genuflexiuni la aparatul hack",
      primary: ["quads", "glutes"], secondary: [], pattern: "squat", equipment: "machine", repMin: 8, repMax: 12, inc: 5 },
    { id: "bl-leg-press", tier: "accessory", name: "Leg Press", name_ro: "Presă pentru picioare",
      primary: ["quads", "glutes"], secondary: [], pattern: "squat", equipment: "machine", repMin: 10, repMax: 15, inc: 5 },
    { id: "bl-chest-supported-row", tier: "accessory", name: "Chest-Supported Row", name_ro: "Ramat la aparat cu sprijin pe piept",
      primary: ["upper/mid back"], secondary: ["rear delts", "biceps"], pattern: "horizontal pull", equipment: "machine", repMin: 8, repMax: 12, inc: 2.5 },
    { id: "bl-incline-db-curl", tier: "accessory", name: "Incline Dumbbell Curl", name_ro: "Flexii pentru biceps cu gantere, pe banca înclinată",
      primary: ["biceps"], secondary: [], pattern: "elbow flexion", equipment: "dumbbells + incline bench", repMin: 10, repMax: 15, inc: 1 },
    { id: "bl-standing-db-curl", tier: "accessory", name: "Standing Dumbbell Curl", name_ro: "Flexii pentru biceps cu gantere, din stând",
      primary: ["biceps"], secondary: ["forearms"], pattern: "elbow flexion", equipment: "dumbbells", repMin: 10, repMax: 15, inc: 1 },
    { id: "bl-machine-preacher-curl", tier: "accessory", name: "Machine Preacher Curl", name_ro: "Flexii pentru biceps la aparatul Scott",
      primary: ["biceps"], secondary: [], pattern: "elbow flexion", equipment: "machine", repMin: 10, repMax: 15, inc: 2.5 },
    { id: "bl-standing-calf-raise", tier: "accessory", name: "Standing Calf Raise", name_ro: "Ridicări pe vârfuri din stând, la aparat",
      primary: ["calves"], secondary: [], pattern: "ankle extension", equipment: "machine", repMin: 10, repMax: 15, inc: 5 },

    // ---- cardio (progression: duration first, then intensity) ----
    { id: "bl-treadmill-run", tier: "cardio", kind: "cardio", cardio: "run", name: "Treadmill Run", name_ro: "Alergare pe bandă",
      primary: ["heart & lungs"], secondary: ["legs"], pattern: "running", equipment: "treadmill", durMin: 20, durMax: 40, intLabel: "km/h", intStep: 0.5 },
    { id: "bl-stationary-bike", tier: "cardio", kind: "cardio", cardio: "bike", name: "Stationary Bike", name_ro: "Bicicletă staționară",
      primary: ["heart & lungs"], secondary: ["quads"], pattern: "cycling", equipment: "stationary bike", durMin: 20, durMax: 45, intLabel: "level", intStep: 1 },
    { id: "bl-incline-walk", tier: "cardio", kind: "cardio", cardio: "walk", name: "Incline Treadmill Walk", name_ro: "Mers în pantă pe bandă",
      primary: ["heart & lungs"], secondary: ["glutes", "calves"], pattern: "walking", equipment: "treadmill", durMin: 20, durMax: 45, intLabel: "incline %", intStep: 1 },
    { id: "bl-stair-climber", tier: "cardio", kind: "cardio", cardio: "stairs", name: "Stair Climber", name_ro: "Simulator de scări (stepper)",
      primary: ["heart & lungs"], secondary: ["glutes", "quads"], pattern: "climbing", equipment: "stair machine", durMin: 10, durMax: 30, intLabel: "level", intStep: 1 },
    { id: "bl-elliptical", tier: "cardio", kind: "cardio", cardio: "elliptical", name: "Elliptical", name_ro: "Bicicletă eliptică",
      primary: ["heart & lungs"], secondary: ["full body"], pattern: "elliptical", equipment: "elliptical trainer", durMin: 20, durMax: 40, intLabel: "level", intStep: 1 },
  ];

  // Which real-world standard (js/standards.js) each built-in exercise is ranked against.
  // Preacher machine → "Machine Bicep Curl" is the closest standard available (an approximation).
  // Running and bike ranks come from the cardio data, not this map; walk/stairs/elliptical have no real-world standard.
  const STD = {
    "bl-machine-chest-press": "chest-press", "bl-lat-pulldown": "lat-pulldown", "bl-45-back-extension": "back-extension",
    "bl-seated-leg-curl": "seated-leg-curl", "bl-seated-db-shoulder-press": "dumbbell-shoulder-press", "bl-goblet-squat": "goblet-squat",
    "bl-hack-squat": "hack-squat", "bl-leg-press": "sled-leg-press", "bl-chest-supported-row": "machine-row",
    "bl-incline-db-curl": "incline-dumbbell-curl", "bl-standing-db-curl": "dumbbell-curl", "bl-machine-preacher-curl": "machine-bicep-curl",
    "bl-standing-calf-raise": "machine-calf-raise",
  };

  // Exercises in the same group can replace each other. Listed by id.
  const SUBSTITUTE_GROUPS = {
    quads: ["bl-goblet-squat", "bl-hack-squat", "bl-leg-press"],
    biceps: ["bl-incline-db-curl", "bl-standing-db-curl", "bl-machine-preacher-curl"],
    back: ["bl-lat-pulldown", "bl-chest-supported-row"],
    cardio: ["bl-treadmill-run", "bl-stationary-bike", "bl-incline-walk", "bl-stair-climber", "bl-elliptical"],
  };

  const DEFAULT_SETS = 3;
  // Fields owned by the library: refreshed on every seed so edits to this file reach existing users.
  // Everything else (name, reps, sets, step, durations, intensity) belongs to the user once seeded and is never overwritten.
  const CATALOG_FIELDS = ["is_baseline", "name_ro", "tier", "primary", "secondary", "pattern", "equipment", "substitutes", "std", "kind", "cardio"];

  const lbStep = (kg) => Math.max(2.5, Math.round((kg * 2) / 2.5) * 2.5);
  const norm = (s) => String(s || "").trim().toLowerCase();

  function substitutesFor(id) {
    const out = new Set();
    for (const group of Object.values(SUBSTITUTE_GROUPS)) {
      if (group.includes(id)) group.forEach((x) => x !== id && out.add(x));
    }
    return [...out];
  }

  /**
   * Idempotent: adds baseline exercises that are missing (by id) and refreshes library-owned fields.
   * Never deletes, never changes user-tuned fields, never touches the user's own exercises.
   * If the user already has their OWN exercise with the same English name, that baseline entry is
   * skipped so there are no duplicate names (and their history stays on their exercise).
   * Returns true if `db` changed and should be saved.
   */
  function seed(db) {
    const unit = (db.settings && db.settings.unit) || "kg";
    const ids = new Set(db.exercises.map((e) => e.id));
    const ownNames = new Set(db.exercises.filter((e) => !e.is_baseline).map((e) => norm(e.name)));
    let changed = false;

    for (const b of EXERCISES) {
      if (ids.has(b.id) || ownNames.has(norm(b.name))) continue;
      db.exercises.push(b.kind === "cardio"
        ? { id: b.id, name: b.name, durMin: b.durMin, durMax: b.durMax, intLabel: b.intLabel, intStep: b.intStep }
        : { id: b.id, name: b.name, repMin: b.repMin, repMax: b.repMax, sets: DEFAULT_SETS, inc: unit === "lb" ? lbStep(b.inc) : b.inc });
      ids.add(b.id);
      changed = true;
    }

    for (const b of EXERCISES) {
      const ex = db.exercises.find((e) => e.id === b.id);
      if (!ex) continue;
      const catalog = {
        is_baseline: true, name_ro: b.name_ro, tier: b.tier, primary: b.primary, secondary: b.secondary,
        pattern: b.pattern, equipment: b.equipment, substitutes: substitutesFor(b.id).filter((id) => ids.has(id)),
        std: STD[b.id], kind: b.kind, cardio: b.cardio,
      };
      const current = JSON.stringify(CATALOG_FIELDS.map((k) => ex[k]));
      if (current !== JSON.stringify(CATALOG_FIELDS.map((k) => catalog[k]))) {
        Object.assign(ex, catalog);
        changed = true;
      }
    }
    return changed;
  }

  window.Baseline = { EXERCISES, SUBSTITUTE_GROUPS, seed, substitutesFor };
})();
