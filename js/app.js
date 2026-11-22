// UI: views, modals, event handling. Re-renders the current view from `db` on every change.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  let db = Store.load();
  if (Baseline.seed(db)) Store.save(db); // idempotent: only adds/refreshes built-in exercises
  const ui = {
    tab: sessionStorage.getItem("tab") || "workout",
    foodDay: Store.dayKey(),
    modal: null,
    histMode: "exercise",
    histEx: null,
    routineDraft: null,
  };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => {
    if (v === "" || v == null) return null;
    const n = parseFloat(String(v).replace(",", "."));
    return isFinite(n) ? n : null;
  };
  const fmt = (n) => (n == null ? "" : String(Math.round(n * 100) / 100));
  const r0 = (n) => Math.round(n || 0);
  const unit = () => db.settings.unit;
  const exById = (id) => db.exercises.find((e) => e.id === id);
  const foodById = (id) => db.foods.find((f) => f.id === id);
  const sortedExercises = () => [...db.exercises].sort((a, b) => a.name.localeCompare(b.name));
  // Lowercase + strip diacritics, so "tractiuni" matches "Tracțiuni".
  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const exMatches = (e, q) => fold(e.name).includes(q) || fold(e.name_ro).includes(q);
  const builtIn = (e) => (e.is_baseline ? ` <span class="badge">Built-in</span>` : "");
  const roLine = (e) => (e.name_ro ? `<div class="muted small ro">${esc(e.name_ro)}</div>` : "");
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  function dayLabel(key) {
    const today = Store.dayKey();
    if (key === today) return "Today";
    if (key === Store.shiftDay(today, -1)) return "Yesterday";
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function persist() { Store.save(db); }
  function commit() { persist(); render(); }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  // ---------- workout logic ----------
  function suggestionFor(exId) {
    const ex = exById(exId);
    const last = Progression.lastEntry(db.sessions, exId);
    const lastSets = last ? Progression.doneSets(last.entry) : [];
    return { ex, last, lastSets, sug: Progression.suggest(ex, lastSets) };
  }

  // Placeholder/target for a set: the suggestion, but carry a weight you changed on the previous set forward.
  function effTarget(entry, si, sug) {
    const t = sug.targets[Math.min(si, sug.targets.length - 1)];
    const prev = entry.sets[si - 1];
    const w = prev && prev.w != null ? prev.w : t.w;
    return { w, r: t.r };
  }

  function newEntry(exId) {
    const { sug } = suggestionFor(exId);
    return { exerciseId: exId, sets: sug.targets.map(() => ({ w: null, r: null, done: false })) };
  }

  function startWorkout(routineId) {
    const routine = db.routines.find((r) => r.id === routineId);
    const ids = routine ? routine.exerciseIds.filter(exById) : [];
    db.active = { id: Store.uid(), date: new Date().toISOString(), routineId: routine ? routine.id : null, entries: ids.map(newEntry) };
    commit();
    window.scrollTo(0, 0);
  }

  function finishWorkout() {
    const a = db.active;
    const entries = a.entries
      .map((e) => ({ exerciseId: e.exerciseId, sets: e.sets.filter((s) => s.done).map((s) => ({ w: s.w, r: s.r, done: true })) }))
      .filter((e) => e.sets.length);
    if (!entries.length) {
      if (confirm("No completed sets. Discard this workout?")) { db.active = null; commit(); }
      return;
    }
    const prs = [];
    for (const e of entries) {
      const rec = Progression.records(db.sessions, e.exerciseId);
      if (!rec.history.length) continue;
      const best = Math.max(...e.sets.map((s) => Progression.e1rm(s.w, s.r)));
      const top = Math.max(...e.sets.map((s) => s.w));
      if (best > rec.maxE + 0.01 || top > rec.maxW) prs.push(exById(e.exerciseId)?.name);
    }
    const nSets = entries.reduce((n, e) => n + e.sets.length, 0);
    db.sessions.push({ ...a, entries, finishedAt: new Date().toISOString() });
    db.active = null;
    commit();
    window.scrollTo(0, 0);
    toast(`Saved: ${entries.length} exercise${entries.length === 1 ? "" : "s"}, ${nSets} sets.` + (prs.length ? ` 🏆 PR: ${prs.join(", ")}` : ""));
  }

  // ---------- views ----------
  function render() {
    document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === ui.tab));
    const views = { workout: viewWorkout, food: viewFood, history: viewHistory, settings: viewSettings };
    $("#view").innerHTML = views[ui.tab]();
    renderModal();
  }

  function viewWorkout() {
    if (db.active) return viewActive();
    let h = `<h1>Workout</h1><section class="card"><div class="stack">`;
    for (const r of db.routines) {
      h += `<button class="btn primary big" data-act="startRoutine" data-id="${r.id}">▶ ${esc(r.name)}<small>${r.exerciseIds.length} exercises</small></button>`;
    }
    h += `<button class="btn big" data-act="startEmpty">▶ Empty workout</button></div>`;
    const last = db.sessions[db.sessions.length - 1];
    if (last) {
      const rn = db.routines.find((r) => r.id === last.routineId)?.name || "Workout";
      const n = last.entries.reduce((k, e) => k + e.sets.length, 0);
      h += `<p class="muted small mt">Last: ${esc(rn)} · ${fmtDate(last.date)} · ${n} sets</p>`;
    }
    h += `</section>`;

    h += `<section class="card"><div class="row-between"><h2>Routines</h2><button class="btn sm" data-act="newRoutine">+ New</button></div>`;
    if (!db.routines.length) h += `<p class="muted">No routines yet. Make one like “Push” or “Upper A” so its exercises load automatically.</p>`;
    for (const r of db.routines) {
      h += `<div class="list-item" data-act="editRoutine" data-id="${r.id}"><div><b>${esc(r.name)}</b><div class="muted small">${r.exerciseIds.map((id) => esc(exById(id)?.name || "?")).join(" · ") || "empty"}</div></div><span class="chev">›</span></div>`;
    }
    h += `</section>`;

    h += `<section class="card"><div class="row-between"><h2>Exercises</h2><button class="btn sm" data-act="newExercise">+ New</button></div>`;
    if (!db.exercises.length) h += `<p class="muted">No exercises yet.</p>`;
    for (const e of sortedExercises()) {
      h += `<div class="list-item" data-act="editExercise" data-id="${e.id}"><div><b>${esc(e.name)}</b>${builtIn(e)}${roLine(e)}<div class="muted small">${e.sets}×${e.repMin}–${e.repMax} · +${fmt(e.inc)} ${unit()}</div></div><span class="chev">›</span></div>`;
    }
    h += `</section>`;
    return h;
  }

  function viewActive() {
    const a = db.active;
    const routine = db.routines.find((r) => r.id === a.routineId);
    let h = `<div class="row-between"><h1>${esc(routine ? routine.name : "Workout")}</h1><span class="muted small">started ${fmtTime(a.date)}</span></div>`;
    a.entries.forEach((en, ei) => (h += entryCard(en, ei)));
    if (!a.entries.length) h += `<p class="muted center">Add your first exercise.</p>`;
    h += `<button class="btn big" data-act="addExToSession">+ Add exercise</button>`;
    h += `<div class="row gap mt"><button class="btn danger" data-act="discardWorkout">Discard</button><button class="btn primary grow" data-act="finishWorkout">Finish workout</button></div>`;
    return h;
  }

  const STATUS = { new: "New", increase: "▲ Go up", build: "Target", struggling: "Hold" };

  function targetText(targets) {
    const ws = [...new Set(targets.map((t) => t.w))];
    const reps = targets.map((t) => t.r).join(" / ");
    if (ws.length === 1) return `${ws[0] == null ? "?" : fmt(ws[0]) + " " + unit()} × ${reps}`;
    return targets.map((t) => `${fmt(t.w)}×${t.r}`).join(", ");
  }

  function entryCard(en, ei) {
    const { ex, last, lastSets, sug } = suggestionFor(en.exerciseId);
    if (!ex) return "";
    const rec = Progression.records(db.sessions, ex.id);
    const done = en.sets.filter((s) => s.done).length;
    let h = `<section class="card ex ${en.sets.length && done === en.sets.length ? "complete" : ""}">
      <div class="row-between"><h2>${esc(ex.name)}</h2><button class="icon" data-act="removeEntry" data-ei="${ei}" aria-label="Remove exercise">✕</button></div>
      <div class="muted small">${ex.sets}×${ex.repMin}–${ex.repMax} · +${fmt(ex.inc)} ${unit()}${rec.maxE ? ` · best e1RM ${fmt(Math.round(rec.maxE * 10) / 10)}` : ""}</div>`;
    if (last) h += `<div class="last"><span class="label">Last · ${fmtDate(last.session.date)}</span>${lastSets.map((s) => `${fmt(s.w)}×${s.r}`).join(", ")}</div>`;
    h += `<div class="target ${sug.status}"><span class="label">${STATUS[sug.status]}</span>${targetText(sug.targets)}<div class="small note">${esc(sug.note)}</div></div>`;
    h += `<div class="sets"><div class="set head"><span>#</span><span>${unit()}</span><span>reps</span><span></span></div>`;
    en.sets.forEach((s, si) => {
      const t = effTarget(en, si, sug);
      const pr = s.done && rec.maxE > 0 && (Progression.e1rm(s.w, s.r) > rec.maxE + 0.01 || s.w > rec.maxW);
      h += `<div class="set ${s.done ? "done" : ""}">
        <span class="n">${pr ? "🏆" : si + 1}</span>
        <input inputmode="decimal" autocomplete="off" data-bind="w" data-ei="${ei}" data-si="${si}" value="${fmt(s.w)}" placeholder="${t.w == null ? "–" : fmt(t.w)}">
        <input inputmode="numeric" autocomplete="off" data-bind="r" data-ei="${ei}" data-si="${si}" value="${fmt(s.r)}" placeholder="${t.r}">
        <button class="check" data-act="toggleSet" data-ei="${ei}" data-si="${si}" aria-label="Complete set">✓</button>
      </div>`;
    });
    h += `</div><div class="row gap"><button class="btn sm" data-act="addSet" data-ei="${ei}">+ Set</button>`;
    if (en.sets.length) h += `<button class="btn sm ghost" data-act="removeSet" data-ei="${ei}">− Set</button>`;
    h += `</div></section>`;
    return h;
  }

  function viewFood() {
    const day = ui.foodDay;
    const entries = db.foodLog.filter((e) => e.day === day);
    const tot = entries.reduce((t, e) => ({ kcal: t.kcal + e.kcal, p: t.p + e.p, c: t.c + e.c, f: t.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 });
    const g = db.settings.goals;
    const left = r0(g.kcal) - r0(tot.kcal);
    const bar = (label, v, goal, cls) => {
      const pct = goal ? Math.min(100, (v / goal) * 100) : 0;
      return `<div class="macro"><div class="row-between small"><span>${label}</span><span>${r0(v)} / ${r0(goal)} g</span></div><div class="bar ${cls}"><i style="width:${pct}%"></i></div></div>`;
    };
    let h = `<div class="daynav"><button class="icon" data-act="dayPrev" aria-label="Previous day">‹</button><b>${dayLabel(day)}</b><button class="icon" data-act="dayNext" aria-label="Next day" ${day >= Store.dayKey() ? "disabled" : ""}>›</button></div>`;
    h += `<section class="card">
      <div class="kcal"><span class="big-num">${r0(tot.kcal)}</span><span class="muted"> / ${r0(g.kcal)} kcal</span></div>
      <div class="small ${left < 0 ? "over" : "muted"}">${left >= 0 ? `${r0(left)} kcal left` : `${r0(-left)} kcal over`}</div>
      <div class="bar kc"><i style="width:${g.kcal ? Math.min(100, (tot.kcal / g.kcal) * 100) : 0}%"></i></div>
      ${bar("Protein", tot.p, g.p, "p")}${bar("Carbs", tot.c, g.c, "c")}${bar("Fat", tot.f, g.f, "f")}
    </section>`;
    h += `<div class="row gap"><button class="btn primary grow big" data-act="openFoodPicker">+ Add food</button><button class="btn big" data-act="quickAdd">Quick add</button></div>`;
    h += `<section class="card"><h2>Entries</h2>`;
    if (!entries.length) h += `<p class="muted">Nothing logged ${day === Store.dayKey() ? "yet today" : "this day"}.</p>`;
    for (const e of entries) {
      const food = e.foodId ? foodById(e.foodId) : null;
      const q = e.foodId ? (food && food.per === "100g" ? `${fmt(e.qty)} g` : `${fmt(e.qty)} serv`) : "";
      h += `<div class="list-item static"><div><b>${esc(e.name)}</b> <span class="muted small">${q}</span><div class="muted small">${r0(e.kcal)} kcal · P ${r0(e.p)} · C ${r0(e.c)} · F ${r0(e.f)}</div></div><button class="icon" data-act="delLog" data-id="${e.id}" aria-label="Delete entry">✕</button></div>`;
    }
    h += `</section>`;
    return h;
  }

  function spark(vals) {
    if (vals.length < 2) return `<p class="muted small">The trend chart appears after 2 sessions.</p>`;
    const W = 300, H = 80, pad = 6, min = Math.min(...vals), max = Math.max(...vals);
    const x = (i) => pad + (i * (W - 2 * pad)) / (vals.length - 1);
    const y = (v) => (max === min ? H / 2 : H - pad - ((v - min) * (H - 2 * pad)) / (max - min));
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="e1RM trend"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>
      <div class="row-between muted small"><span>${fmt(Math.round(min))}</span><span>est. 1RM trend</span><span>${fmt(Math.round(max))}</span></div>`;
  }

  function viewHistory() {
    let h = `<h1>History</h1><div class="seg"><button class="${ui.histMode === "exercise" ? "on" : ""}" data-act="histMode" data-v="exercise">By exercise</button><button class="${ui.histMode === "sessions" ? "on" : ""}" data-act="histMode" data-v="sessions">Sessions</button></div>`;
    if (ui.histMode === "sessions") {
      if (!db.sessions.length) return h + `<p class="muted center">No finished workouts yet.</p>`;
      for (const s of [...db.sessions].reverse()) {
        const rn = db.routines.find((r) => r.id === s.routineId)?.name || "Workout";
        h += `<section class="card"><div class="row-between"><h2>${esc(rn)} <span class="muted small">${fmtDate(s.date)}</span></h2><button class="icon" data-act="delSession" data-id="${s.id}" aria-label="Delete session">✕</button></div>`;
        for (const e of s.entries) h += `<div class="small"><b>${esc(exById(e.exerciseId)?.name || "(deleted)")}</b>: ${e.sets.map((x) => `${fmt(x.w)}×${x.r}`).join(", ")}</div>`;
        h += `</section>`;
      }
      return h;
    }
    if (ui.histEx && exById(ui.histEx)) {
      const ex = exById(ui.histEx);
      const rec = Progression.records(db.sessions, ex.id);
      h += `<button class="btn sm ghost" data-act="histBack">‹ All exercises</button>
        <section class="card"><div class="row-between"><h2>${esc(ex.name)}</h2><button class="btn sm" data-act="editExercise" data-id="${ex.id}">Edit</button></div>
        <div class="stats"><div><span class="muted small">Heaviest</span><b>${fmt(rec.maxW)} ${unit()}</b></div><div><span class="muted small">Best e1RM</span><b>${fmt(Math.round(rec.maxE * 10) / 10)} ${unit()}</b></div><div><span class="muted small">Sessions</span><b>${rec.history.length}</b></div></div>
        ${spark(rec.history.map((x) => x.e1rm))}</section>`;
      for (const x of [...rec.history].reverse()) {
        h += `<div class="list-item static"><div><b>${fmtDate(x.date)}</b><div class="small">${x.sets.map((s) => `${fmt(s.w)}×${s.r}`).join(", ")}</div></div><span class="muted small">e1RM ${fmt(Math.round(x.e1rm))}</span></div>`;
      }
      return h;
    }
    const rows = sortedExercises().map((e) => ({ e, rec: Progression.records(db.sessions, e.id) })).filter((x) => x.rec.history.length);
    if (!rows.length) return h + `<p class="muted center">Finish a workout to see progress here.</p>`;
    rows.sort((a, b) => b.rec.history[b.rec.history.length - 1].date.localeCompare(a.rec.history[a.rec.history.length - 1].date));
    for (const { e, rec } of rows) {
      const lastH = rec.history[rec.history.length - 1];
      h += `<div class="list-item" data-act="histEx" data-id="${e.id}"><div><b>${esc(e.name)}</b><div class="muted small">last ${fmtDate(lastH.date)} · top ${fmt(rec.maxW)} ${unit()} · e1RM ${fmt(Math.round(rec.maxE))}</div></div><span class="chev">›</span></div>`;
    }
    return h;
  }

  function viewSettings() {
    const g = db.settings.goals;
    const lastBk = db.settings.lastExport ? fmtDate(db.settings.lastExport) : "never";
    return `<h1>Settings</h1>
      <section class="card"><h2>Units</h2><div class="seg"><button class="${unit() === "kg" ? "on" : ""}" data-act="setUnit" data-v="kg">kg</button><button class="${unit() === "lb" ? "on" : ""}" data-act="setUnit" data-v="lb">lb</button></div>
        <p class="muted small">This only changes the label. Numbers aren't converted.</p></section>
      <section class="card"><h2>Daily goals</h2>
        <div class="grid2">
          <label>Calories<input inputmode="numeric" data-goal="kcal" value="${fmt(g.kcal)}"></label>
          <label>Protein (g)<input inputmode="numeric" data-goal="p" value="${fmt(g.p)}"></label>
          <label>Carbs (g)<input inputmode="numeric" data-goal="c" value="${fmt(g.c)}"></label>
          <label>Fat (g)<input inputmode="numeric" data-goal="f" value="${fmt(g.f)}"></label>
        </div>
        <p class="muted small" id="macroKcal">${macroKcalText()}</p></section>
      <section class="card"><h2>Data</h2>
        <p class="muted small">Everything is stored on this device only. Last backup: <b>${lastBk}</b>.</p>
        <div class="stack"><button class="btn" data-act="export">Export backup (.json)</button>
        <label class="btn">Import backup<input type="file" id="importFile" accept=".json,application/json" hidden></label>
        <button class="btn danger" data-act="resetAll">Erase all data</button></div></section>
      <p class="muted small center">Gym Tracker MVP</p>`;
  }

  function macroKcalText() {
    const g = db.settings.goals;
    const k = (g.p || 0) * 4 + (g.c || 0) * 4 + (g.f || 0) * 9;
    return `Your macros add up to ${r0(k)} kcal${g.kcal ? ` (goal ${r0(g.kcal)})` : ""}.`;
  }

  // ---------- modals ----------
  function openModal(m) {
    ui.modal = m;
    renderModal();
    const auto = $("#modal [autofocus]");
    if (auto) { auto.focus(); if (auto.select) auto.select(); }
  }
  function closeModal() {
    // Backing out of a picker/form opened from the routine editor returns to the routine editor.
    const m = ui.modal;
    if (m && m.type !== "routineForm" && (m.mode === "routine" || m.then === "routine")) return openModal({ type: "routineForm" });
    ui.modal = null; renderModal();
  }

  function renderModal() {
    const root = $("#modal");
    const m = ui.modal;
    if (!m) { root.hidden = true; root.innerHTML = ""; document.body.classList.remove("noscroll"); return; }
    const { title, body } = MODALS[m.type]();
    root.hidden = false;
    document.body.classList.add("noscroll");
    root.innerHTML = `<div class="sheet"><header><h2>${esc(title)}</h2><button class="icon" data-act="closeModal" aria-label="Close">✕</button></header><div class="sheet-body">${body}</div></div>`;
  }

  function exPickerList() {
    const m = ui.modal;
    const q = fold(m.q.trim());
    const taken = m.mode === "session" ? db.active.entries.map((e) => e.exerciseId) : ui.routineDraft.exerciseIds;
    const list = sortedExercises().filter((e) => exMatches(e, q));
    let h = "";
    if (q && !db.exercises.some((e) => fold(e.name) === q || fold(e.name_ro) === q)) h += `<button class="btn primary big" data-act="createExFromPicker">+ Create “${esc(m.q.trim())}”</button>`;
    h += list.map((e) => `<div class="list-item" data-act="pickEx" data-id="${e.id}"><div><b>${esc(e.name)}</b>${builtIn(e)}${roLine(e)}<div class="muted small">${e.sets}×${e.repMin}–${e.repMax}</div></div>${taken.includes(e.id) ? `<span class="muted small">added</span>` : `<span class="chev">+</span>`}</div>`).join("");
    if (!db.exercises.length && !q) h += `<p class="muted">No exercises yet. Type a name to create one.</p>`;
    return h;
  }

  function baselineInfo(e) {
    const muscles = [...e.primary, ...e.secondary.map((x) => `${x} (secondary)`)].join(", ");
    const subs = (e.substitutes || []).map((id) => exById(id)?.name).filter(Boolean);
    return `<div class="info small">
      <div><span class="badge">Built-in</span> <span class="muted">${esc(e.tier)} · can't be deleted</span></div>
      <div><span class="muted">Romanian:</span> ${esc(e.name_ro)}</div>
      <div><span class="muted">Muscles:</span> ${esc(muscles)}</div>
      <div><span class="muted">Pattern:</span> ${esc(e.pattern)} · <span class="muted">Equipment:</span> ${esc(e.equipment)}</div>
      ${subs.length ? `<div><span class="muted">Can swap with:</span> ${subs.map(esc).join(", ")}</div>` : ""}
    </div>`;
  }

  function lastUsedFoods() {
    const order = new Map();
    db.foodLog.forEach((e, i) => e.foodId && order.set(e.foodId, i));
    return [...db.foods].sort((a, b) => (order.get(b.id) ?? -1) - (order.get(a.id) ?? -1) || a.name.localeCompare(b.name));
  }
  const perDesc = (f) => `${r0(f.kcal)} kcal · P ${fmt(f.p)} · C ${fmt(f.c)} · F ${fmt(f.f)} per ${f.per === "100g" ? "100 g" : "serving"}`;

  function foodPickerList() {
    const q = ui.modal.q.trim().toLowerCase();
    const list = lastUsedFoods().filter((f) => f.name.toLowerCase().includes(q));
    if (!db.foods.length) return `<p class="muted">No saved foods yet. Tap “New food” and you'll only need to enter it once.</p>`;
    if (!list.length) return `<p class="muted">No match. Create it with “New food”.</p>`;
    return list.map((f) => `<div class="list-item" data-act="pickFood" data-id="${f.id}"><div><b>${esc(f.name)}</b><div class="muted small">${perDesc(f)}</div></div><span class="chev">›</span></div>`).join("");
  }

  function scaleFood(f, qty) {
    const k = f.per === "100g" ? qty / 100 : qty;
    return { kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k };
  }
  const macroLine = (m) => `<b>${r0(m.kcal)} kcal</b> · P ${r0(m.p)} · C ${r0(m.c)} · F ${r0(m.f)}`;

  const MODALS = {
    exPicker() {
      return { title: "Add exercise", body: `<input class="search" type="search" placeholder="Search, or type a new name" data-search="ex" value="${esc(ui.modal.q)}" autofocus><div id="mlist" class="stack">${exPickerList()}</div>` };
    },
    exForm() {
      const m = ui.modal;
      const e = m.id ? exById(m.id) : { name: m.name || "", repMin: 8, repMax: 12, sets: 3, inc: unit() === "kg" ? 2.5 : 5 };
      return {
        title: m.id ? "Edit exercise" : "New exercise",
        body: `<form id="mform" class="stack">
          <label>Name<input name="name" required value="${esc(e.name)}" ${m.id ? "" : "autofocus"}></label>
          <div class="grid2"><label>Min reps<input name="repMin" inputmode="numeric" value="${e.repMin}"></label><label>Max reps<input name="repMax" inputmode="numeric" value="${e.repMax}"></label></div>
          <div class="grid2"><label>Sets<input name="sets" inputmode="numeric" value="${e.sets}"></label><label>Weight step (${unit()})<input name="inc" inputmode="decimal" value="${fmt(e.inc)}"></label></div>
          <p class="muted small">Double progression: once you hit <b>max reps on every set</b>, the target weight goes up by the step and reps reset to min.</p>
          ${e.is_baseline ? baselineInfo(e) : ""}
          <button class="btn primary big" type="submit">Save</button>
          ${m.id && !e.is_baseline ? `<button type="button" class="btn danger" data-act="deleteExercise" data-id="${m.id}">Delete exercise</button>` : ""}
        </form>`,
      };
    },
    routineForm() {
      const d = ui.routineDraft;
      const items = d.exerciseIds.map((id, i) => `<div class="list-item static"><span>${i + 1}. ${esc(exById(id)?.name || "?")}</span><span class="row">
        <button class="icon" data-act="rMove" data-i="${i}" data-d="-1" aria-label="Move up">↑</button><button class="icon" data-act="rMove" data-i="${i}" data-d="1" aria-label="Move down">↓</button><button class="icon" data-act="rRemove" data-i="${i}" aria-label="Remove">✕</button></span></div>`).join("");
      return {
        title: d.id ? "Edit routine" : "New routine",
        body: `<div class="stack"><label>Name<input data-draft="name" value="${esc(d.name)}" placeholder="e.g. Push, Upper A"></label>
          <div>${items || `<p class="muted">No exercises yet.</p>`}</div>
          <button class="btn" data-act="rAddEx">+ Add exercise</button>
          <button class="btn primary big" data-act="saveRoutine">Save routine</button>
          ${d.id ? `<button class="btn danger" data-act="deleteRoutine">Delete routine</button>` : ""}</div>`,
      };
    },
    foodPicker() {
      return {
        title: `Add food · ${dayLabel(ui.foodDay)}`,
        body: `<input class="search" type="search" placeholder="Search saved foods" data-search="food" value="${esc(ui.modal.q)}">
          <div class="row gap"><button class="btn grow" data-act="newFood">+ New food</button><button class="btn grow" data-act="quickAdd">Quick add</button></div>
          <div id="mlist" class="stack mt">${foodPickerList()}</div>`,
      };
    },
    logFood() {
      const f = foodById(ui.modal.foodId);
      const prev = [...db.foodLog].reverse().find((e) => e.foodId === f.id);
      const qty = prev ? prev.qty : f.per === "100g" ? 100 : 1;
      return {
        title: f.name,
        body: `<form id="mform" class="stack"><p class="muted small">${perDesc(f)}</p>
          <label>${f.per === "100g" ? "Amount (g)" : "Servings"}<input name="qty" data-qty inputmode="decimal" value="${fmt(qty)}" autofocus></label>
          <div id="live" class="live">${macroLine(scaleFood(f, qty))}</div>
          <button class="btn primary big" type="submit">Log to ${dayLabel(ui.foodDay)}</button>
          <div class="row gap"><button type="button" class="btn grow" data-act="editFood" data-id="${f.id}">Edit food</button><button type="button" class="btn danger grow" data-act="deleteFood" data-id="${f.id}">Delete food</button></div></form>`,
      };
    },
    foodForm() {
      const m = ui.modal;
      const f = m.id ? foodById(m.id) : { name: "", per: "serving", kcal: "", p: "", c: "", f: "" };
      return {
        title: m.id ? "Edit food" : "New food",
        body: `<form id="mform" class="stack">
          <label>Name<input name="name" required value="${esc(f.name)}" autofocus></label>
          <label>Values are per<select name="per"><option value="serving" ${f.per === "serving" ? "selected" : ""}>1 serving</option><option value="100g" ${f.per === "100g" ? "selected" : ""}>100 g</option></select></label>
          <div class="grid2"><label>Calories<input name="kcal" inputmode="decimal" required value="${fmt(f.kcal)}"></label><label>Protein (g)<input name="p" inputmode="decimal" value="${fmt(f.p)}"></label>
          <label>Carbs (g)<input name="c" inputmode="decimal" value="${fmt(f.c)}"></label><label>Fat (g)<input name="f" inputmode="decimal" value="${fmt(f.f)}"></label></div>
          <button class="btn primary big" type="submit">${m.id ? "Save" : "Save & log"}</button></form>`,
      };
    },
    quickAdd() {
      return {
        title: `Quick add · ${dayLabel(ui.foodDay)}`,
        body: `<form id="mform" class="stack">
          <label>Name (optional)<input name="name" placeholder="Quick add"></label>
          <div class="grid2"><label>Calories<input name="kcal" inputmode="decimal" required autofocus></label><label>Protein (g)<input name="p" inputmode="decimal"></label>
          <label>Carbs (g)<input name="c" inputmode="decimal"></label><label>Fat (g)<input name="f" inputmode="decimal"></label></div>
          <button class="btn primary big" type="submit">Log</button></form>`,
      };
    },
  };

  const SUBMIT = {
    exForm(fd) {
      const m = ui.modal;
      const v = { name: fd.get("name").trim(), repMin: num(fd.get("repMin")), repMax: num(fd.get("repMax")), sets: num(fd.get("sets")), inc: num(fd.get("inc")) };
      if (!v.name) return toast("Name is required");
      if (!(v.repMin > 0 && v.repMax >= v.repMin)) return toast("Rep range must be like 8–12");
      if (!(v.sets > 0)) return toast("Sets must be at least 1");
      if (!(v.inc > 0)) return toast("Weight step must be more than 0");
      v.repMin = Math.round(v.repMin); v.repMax = Math.round(v.repMax); v.sets = Math.round(v.sets);
      if (m.id) {
        Object.assign(exById(m.id), v);
        closeModal(); commit(); return;
      }
      if (db.exercises.some((e) => e.name.toLowerCase() === v.name.toLowerCase())) return toast("An exercise with that name exists");
      const ex = { id: Store.uid(), ...v };
      db.exercises.push(ex);
      if (m.then === "session") { db.active.entries.push(newEntry(ex.id)); closeModal(); }
      else if (m.then === "routine") { ui.routineDraft.exerciseIds.push(ex.id); openModal({ type: "routineForm" }); }
      else closeModal();
      commit();
    },
    logFood(fd) {
      const f = foodById(ui.modal.foodId);
      const qty = num(fd.get("qty"));
      if (!(qty > 0)) return toast("Enter an amount");
      db.foodLog.push({ id: Store.uid(), day: ui.foodDay, foodId: f.id, name: f.name, qty, ...scaleFood(f, qty) });
      closeModal(); commit(); toast(`Logged ${f.name}`);
    },
    foodForm(fd) {
      const m = ui.modal;
      const v = { name: fd.get("name").trim(), per: fd.get("per"), kcal: num(fd.get("kcal")) || 0, p: num(fd.get("p")) || 0, c: num(fd.get("c")) || 0, f: num(fd.get("f")) || 0 };
      if (!v.name) return toast("Name is required");
      if (m.id) { Object.assign(foodById(m.id), v); persist(); openModal({ type: "logFood", foodId: m.id }); return; }
      const food = { id: Store.uid(), ...v };
      db.foods.push(food); persist();
      openModal({ type: "logFood", foodId: food.id });
    },
    quickAdd(fd) {
      const kcal = num(fd.get("kcal"));
      if (kcal == null) return toast("Enter calories");
      db.foodLog.push({ id: Store.uid(), day: ui.foodDay, foodId: null, name: fd.get("name").trim() || "Quick add", qty: 1, kcal, p: num(fd.get("p")) || 0, c: num(fd.get("c")) || 0, f: num(fd.get("f")) || 0 });
      closeModal(); commit();
    },
  };

  // ---------- actions ----------
  const ACTIONS = {
    closeModal,
    // workout
    startRoutine: (d) => startWorkout(d.id),
    startEmpty: () => startWorkout(null),
    finishWorkout,
    discardWorkout: () => { if (confirm("Discard this workout? Logged sets will be lost.")) { db.active = null; commit(); } },
    addExToSession: () => openModal({ type: "exPicker", mode: "session", q: "" }),
    removeEntry: (d) => {
      const en = db.active.entries[d.ei];
      if (en.sets.some((s) => s.done) && !confirm("Remove this exercise and its sets?")) return;
      db.active.entries.splice(d.ei, 1); commit();
    },
    addSet: (d) => { db.active.entries[d.ei].sets.push({ w: null, r: null, done: false }); commit(); },
    removeSet: (d) => { db.active.entries[d.ei].sets.pop(); commit(); },
    toggleSet: (d) => {
      const en = db.active.entries[d.ei];
      const s = en.sets[d.si];
      if (s.done) { s.done = false; return commit(); }
      const t = effTarget(en, +d.si, suggestionFor(en.exerciseId).sug);
      const w = s.w != null ? s.w : t.w;
      const r = s.r != null ? s.r : t.r;
      if (w == null) {
        toast("Enter a weight first (0 for bodyweight)");
        $(`input[data-bind="w"][data-ei="${d.ei}"][data-si="${d.si}"]`)?.focus();
        return;
      }
      Object.assign(s, { w, r, done: true });
      commit();
    },
    pickEx: (d) => {
      const m = ui.modal;
      if (m.mode === "session") {
        if (db.active.entries.some((e) => e.exerciseId === d.id)) return toast("Already in this workout");
        db.active.entries.push(newEntry(d.id)); closeModal(); commit();
      } else {
        ui.routineDraft.exerciseIds.push(d.id); openModal({ type: "routineForm" });
      }
    },
    createExFromPicker: () => openModal({ type: "exForm", name: ui.modal.q.trim(), then: ui.modal.mode }),
    newExercise: () => openModal({ type: "exForm" }),
    editExercise: (d) => openModal({ type: "exForm", id: d.id }),
    deleteExercise: (d) => {
      if (exById(d.id)?.is_baseline) return toast("Built-in exercises can't be deleted.");
      if (db.sessions.some((s) => s.entries.some((e) => e.exerciseId === d.id)) || db.active?.entries.some((e) => e.exerciseId === d.id)) {
        return toast("This exercise has logged history. Rename it instead.");
      }
      if (!confirm("Delete this exercise?")) return;
      db.exercises = db.exercises.filter((e) => e.id !== d.id);
      db.routines.forEach((r) => (r.exerciseIds = r.exerciseIds.filter((x) => x !== d.id)));
      closeModal(); commit();
    },
    // routines
    newRoutine: () => { ui.routineDraft = { name: "", exerciseIds: [] }; openModal({ type: "routineForm" }); },
    editRoutine: (d) => { const r = db.routines.find((x) => x.id === d.id); ui.routineDraft = { id: r.id, name: r.name, exerciseIds: [...r.exerciseIds] }; openModal({ type: "routineForm" }); },
    rAddEx: () => openModal({ type: "exPicker", mode: "routine", q: "" }),
    rMove: (d) => {
      const a = ui.routineDraft.exerciseIds, i = +d.i, j = i + +d.d;
      if (j < 0 || j >= a.length) return;
      [a[i], a[j]] = [a[j], a[i]]; renderModal();
    },
    rRemove: (d) => { ui.routineDraft.exerciseIds.splice(+d.i, 1); renderModal(); },
    saveRoutine: () => {
      const d = ui.routineDraft;
      if (!d.name.trim()) return toast("Give the routine a name");
      if (d.id) Object.assign(db.routines.find((r) => r.id === d.id), { name: d.name.trim(), exerciseIds: d.exerciseIds });
      else db.routines.push({ id: Store.uid(), name: d.name.trim(), exerciseIds: d.exerciseIds });
      closeModal(); commit();
    },
    deleteRoutine: () => {
      if (!confirm("Delete this routine? Past workouts are kept.")) return;
      db.routines = db.routines.filter((r) => r.id !== ui.routineDraft.id);
      closeModal(); commit();
    },
    // food
    dayPrev: () => { ui.foodDay = Store.shiftDay(ui.foodDay, -1); render(); },
    dayNext: () => { if (ui.foodDay < Store.dayKey()) { ui.foodDay = Store.shiftDay(ui.foodDay, 1); render(); } },
    openFoodPicker: () => openModal({ type: "foodPicker", q: "" }),
    pickFood: (d) => openModal({ type: "logFood", foodId: d.id }),
    newFood: () => openModal({ type: "foodForm" }),
    editFood: (d) => openModal({ type: "foodForm", id: d.id }),
    deleteFood: (d) => {
      if (!confirm("Delete this saved food? Past log entries stay.")) return;
      db.foods = db.foods.filter((f) => f.id !== d.id);
      db.foodLog.forEach((e) => { if (e.foodId === d.id) e.foodId = null; });
      closeModal(); commit();
    },
    quickAdd: () => openModal({ type: "quickAdd" }),
    delLog: (d) => { db.foodLog = db.foodLog.filter((e) => e.id !== d.id); commit(); },
    // history
    histMode: (d) => { ui.histMode = d.v; ui.histEx = null; render(); },
    histEx: (d) => { ui.histEx = d.id; render(); window.scrollTo(0, 0); },
    histBack: () => { ui.histEx = null; render(); },
    delSession: (d) => {
      if (!confirm("Delete this workout from history?")) return;
      db.sessions = db.sessions.filter((s) => s.id !== d.id); commit();
    },
    // settings
    setUnit: (d) => { db.settings.unit = d.v; commit(); },
    export: () => { db.settings.lastExport = new Date().toISOString(); persist(); Store.exportJSON(db); render(); },
    resetAll: () => {
      if (!confirm("Erase ALL workouts, foods and settings on this device?")) return;
      if (!confirm("Really? This can't be undone unless you have a backup.")) return;
      db = Store.defaults(); Baseline.seed(db); commit();
    },
  };

  // ---------- events ----------
  document.addEventListener("click", (ev) => {
    const tab = ev.target.closest(".tabbar button");
    if (tab) {
      ui.tab = tab.dataset.tab; sessionStorage.setItem("tab", ui.tab);
      ui.histEx = null; render(); window.scrollTo(0, 0); return;
    }
    const el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.act];
    if (fn) { ev.preventDefault(); fn(el.dataset, el); }
  });

  document.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.dataset.bind && db.active) {
      const s = db.active.entries[t.dataset.ei]?.sets[t.dataset.si];
      if (!s) return;
      s[t.dataset.bind] = num(t.value);
      persist();
      // keep the next set's weight placeholder in sync with an edited weight
      if (t.dataset.bind === "w") {
        const next = $(`input[data-bind="w"][data-ei="${t.dataset.ei}"][data-si="${+t.dataset.si + 1}"]`);
        if (next && s.w != null) next.placeholder = fmt(s.w);
      }
    } else if (t.dataset.search) {
      ui.modal.q = t.value;
      $("#mlist").innerHTML = t.dataset.search === "ex" ? exPickerList() : foodPickerList();
    } else if (t.dataset.draft) {
      ui.routineDraft[t.dataset.draft] = t.value;
    } else if (t.dataset.goal) {
      db.settings.goals[t.dataset.goal] = num(t.value) || 0;
      persist();
      $("#macroKcal").textContent = macroKcalText();
    } else if (t.hasAttribute("data-qty")) {
      const f = foodById(ui.modal.foodId);
      $("#live").innerHTML = macroLine(scaleFood(f, num(t.value) || 0));
    }
  });

  // Enter in the search box: pick the first result, or create a new exercise.
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || !ev.target.dataset.search) return;
    ev.preventDefault();
    const first = $('#mlist [data-act="pickEx"], #mlist [data-act="pickFood"]') || $("#mlist [data-act]");
    if (first) first.click();
  });

  document.addEventListener("submit", (ev) => {
    if (ev.target.id !== "mform") return;
    ev.preventDefault();
    SUBMIT[ui.modal.type](new FormData(ev.target));
  });

  document.addEventListener("change", async (ev) => {
    if (ev.target.id !== "importFile") return;
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = Store.parseImport(await file.text());
      if (!confirm(`Replace everything on this device with this backup (${data.sessions.length} workouts, ${data.foodLog.length} food entries)?`)) return;
      Baseline.seed(data); // older backups get the built-in library too
      db = data; commit(); toast("Backup restored");
    } catch (e) {
      alert("Import failed: " + e.message);
    } finally {
      ev.target.value = "";
    }
  });

  // Reset the food day when the app is reopened on a new day.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !ui.modal) {
      const today = Store.dayKey();
      if (ui.foodDay > today) ui.foodDay = today;
      render();
    }
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW failed", e));
  }

  render();
})();
