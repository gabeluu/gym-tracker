// Persistence: one JSON blob in localStorage, plus export/import.
(function () {
  const KEY = "gymtracker.v1";

  function defaults() {
    return {
      version: 1,
      settings: { unit: "kg", goals: { kcal: 2500, p: 180, c: 250, f: 80 } },
      exercises: [],
      routines: [],
      sessions: [],
      active: null,
      foods: [],
      foodLog: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      return Object.assign(defaults(), JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load data", e);
      return defaults();
    }
  }

  function save(db) {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      alert("Could not save data: " + e.message);
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Local calendar day as YYYY-MM-DD (not UTC).
  function dayKey(d) {
    d = d ? new Date(d) : new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${dd}`;
  }

  function shiftDay(key, delta) {
    const [y, m, d] = key.split("-").map(Number);
    return dayKey(new Date(y, m - 1, d + delta));
  }

  function exportJSON(db) {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gym-tracker-backup-${dayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function parseImport(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.exercises) || !Array.isArray(data.sessions)) {
      throw new Error("This doesn't look like a Gym Tracker backup.");
    }
    return Object.assign(defaults(), data);
  }

  // Ask the browser not to evict our storage (best effort).
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  window.Store = { load, save, uid, dayKey, shiftDay, exportJSON, parseImport, defaults };
})();
