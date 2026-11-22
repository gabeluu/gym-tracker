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
  ];

  // Exercises in the same group can replace each other. Listed by id.
  const SUBSTITUTE_GROUPS = {
    quads: ["bl-goblet-squat", "bl-hack-squat", "bl-leg-press"],
    biceps: ["bl-incline-db-curl", "bl-standing-db-curl", "bl-machine-preacher-curl"],
    back: ["bl-lat-pulldown", "bl-chest-supported-row"],
  };

  const DEFAULT_SETS = 3;
  // Fields owned by the library: refreshed on every seed so edits to this file reach existing users.
  // Everything else (name, repMin, repMax, sets, inc) belongs to the user once seeded and is never overwritten.
  const CATALOG_FIELDS = ["is_baseline", "name_ro", "tier", "primary", "secondary", "pattern", "equipment", "substitutes"];

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
      db.exercises.push({
        id: b.id, name: b.name, repMin: b.repMin, repMax: b.repMax, sets: DEFAULT_SETS,
        inc: unit === "lb" ? lbStep(b.inc) : b.inc,
      });
      ids.add(b.id);
      changed = true;
    }

    for (const b of EXERCISES) {
      const ex = db.exercises.find((e) => e.id === b.id);
      if (!ex) continue;
      const catalog = {
        is_baseline: true, name_ro: b.name_ro, tier: b.tier, primary: b.primary, secondary: b.secondary,
        pattern: b.pattern, equipment: b.equipment, substitutes: substitutesFor(b.id).filter((id) => ids.has(id)),
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
