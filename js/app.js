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

  let achCache = null, rankCache = null; // see ach() and rk()
  function persist() { Store.save(db); achCache = null; rankCache = null; }
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
  const isCardio = (ex) => !!ex && ex.kind === "cardio";
  // Defaults when you create a cardio exercise of each type.
  const CARDIO_TYPES = {
    run: { label: "Running (treadmill / outdoor)", intLabel: "km/h", intStep: 0.5, durMin: 20, durMax: 40 },
    bike: { label: "Stationary bike", intLabel: "level", intStep: 1, durMin: 20, durMax: 45 },
    walk: { label: "Incline walk", intLabel: "incline %", intStep: 1, durMin: 20, durMax: 45 },
    stairs: { label: "Stairs", intLabel: "level", intStep: 1, durMin: 10, durMax: 30 },
    elliptical: { label: "Elliptical", intLabel: "level", intStep: 1, durMin: 20, durMax: 40 },
    other: { label: "Other cardio", intLabel: "level", intStep: 1, durMin: 20, durMax: 40 },
  };
  // Short description of an exercise's progression settings, for lists.
  const exSub = (e) => (isCardio(e) ? `Cardio · ${e.durMin}–${e.durMax} min · +${fmt(e.intStep)} ${esc(e.intLabel)}` : `${e.sets}×${e.repMin}–${e.repMax} · +${fmt(e.inc)} ${unit()}`);
  // One logged set/bout as text: "60×10" or "30 min @ 10 km/h · 5 km · 180 W".
  function fmtSet(ex, s) {
    if (!isCardio(ex)) return `${fmt(s.w)}×${s.r}`;
    const km = Progression.cardioKm(ex, s);
    return `${fmt(s.min)} min${s.int != null ? ` @ ${fmt(s.int)} ${ex.intLabel || ""}` : ""}${km ? ` · ${fmt(km)} km` : ""}${s.watts ? ` · ${fmt(s.watts)} W` : ""}`;
  }

  function suggestionFor(exId) {
    const ex = exById(exId);
    const [last, prev] = Progression.recentEntries(db.sessions, exId, 2);
    if (isCardio(ex)) {
      const lastSets = last ? Progression.doneCardio(last.entry) : [];
      return { ex, last, lastSets, sug: Progression.suggestCardio(ex, lastSets) };
    }
    const lastSets = last ? Progression.doneSets(last.entry) : [];
    const prevSets = prev ? Progression.doneSets(prev.entry) : [];
    return { ex, last, lastSets, sug: Progression.suggest(ex, lastSets, prevSets) };
  }

  // Placeholder/target for a set: the suggestion, but carry a weight/intensity you changed on the previous set forward.
  function effTarget(entry, si, sug) {
    const t = sug.targets[Math.min(si, sug.targets.length - 1)];
    const prev = entry.sets[si - 1];
    if ("min" in t) return { min: t.min, int: prev && prev.int != null ? prev.int : t.int };
    const w = prev && prev.w != null ? prev.w : t.w;
    return { w, r: t.r };
  }

  const blankSet = (ex) => (isCardio(ex) ? { min: null, int: null, km: null, watts: null, done: false } : { w: null, r: null, done: false });
  function newEntry(exId) {
    const { ex, sug } = suggestionFor(exId);
    return { exerciseId: exId, sets: sug.targets.map(() => blankSet(ex)) };
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
      .map((e) => ({ exerciseId: e.exerciseId, sets: e.sets.filter((s) => s.done).map((s) => ({ ...s, done: true })) }))
      .filter((e) => e.sets.length);
    if (!entries.length) {
      if (confirm("No completed sets. Discard this workout?")) { db.active = null; commit(); }
      return;
    }
    const nSets = entries.reduce((n, e) => n + e.sets.length, 0);
    const before = Achievements.compute(db), ranksBefore = Ranks.compute(db);
    const { rest, ...session } = a; // the rest timer isn't part of the saved workout
    db.sessions.push({ ...session, entries, finishedAt: new Date().toISOString() });
    db.active = null;
    const after = Achievements.compute(db);
    const { unlocked, levelUps } = Achievements.diff(before, after);
    const rankUps = Ranks.diff(ranksBefore, Ranks.compute(db));
    // PRs from the same rules the awards use (weighted e1RM / top weight, or more bodyweight reps).
    const prs = entries
      .filter((e) => (after.ex.get(e.exerciseId)?.prs || 0) > (before.ex.get(e.exerciseId)?.prs || 0))
      .map((e) => exById(e.exerciseId)?.name || "?");
    commit();
    window.scrollTo(0, 0);
    const summary = `${entries.length} exercise${entries.length === 1 ? "" : "s"}, ${nSets} sets`;
    if (prs.length || unlocked.length || levelUps.length || rankUps.length) openModal({ type: "celebrate", summary, prs, unlocked, levelUps, rankUps });
    else toast(`Saved: ${summary}.`);
  }

  // ---------- rest timer ----------
  // State lives on db.active.rest = { endsAt (ms), total (s), done } so it survives a reload and ends with the workout.
  const restCfg = () => ({ on: true, sec: 90, ...(db.settings.rest || {}) });
  let restTick = null, audioCtx = null;

  function unlockAudio() { // must run inside a tap, or phones block the beep later
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }
  function beep() {
    if (!audioCtx) return;
    try {
      [0, 0.25].forEach((t) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
        const at = audioCtx.currentTime + t;
        g.gain.setValueAtTime(0.25, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
        o.start(at); o.stop(at + 0.2);
      });
    } catch (e) { /* audio unavailable */ }
  }
  function startRest(ex) {
    const cfg = restCfg();
    const sec = ex && ex.rest != null ? ex.rest : cfg.sec;
    if (!cfg.on || !(sec > 0)) return;
    db.active.rest = { endsAt: Date.now() + sec * 1000, total: sec, done: false };
    persist(); syncRest();
  }
  function syncRest() {
    if (db.active?.rest && !restTick) restTick = setInterval(tickRest, 250);
    tickRest();
  }
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  function tickRest() {
    const bar = $("#restbar"), r = db.active?.rest;
    const over = r ? Date.now() - r.endsAt : 0;
    if (!r || over > 30000) { // hide 30 s after it ends
      if (r) { delete db.active.rest; persist(); }
      bar.hidden = true; document.body.classList.remove("resting");
      clearInterval(restTick); restTick = null; return;
    }
    if (over >= 0 && !r.done) {
      r.done = true; persist();
      if (over < 5000) { navigator.vibrate?.([400, 150, 400]); beep(); } // don't buzz for a rest that ended while the app was closed
    }
    const left = Math.max(0, Math.ceil(-over / 1000));
    bar.hidden = false; document.body.classList.add("resting");
    bar.classList.toggle("over", over >= 0);
    $("#restTime").textContent = over >= 0 ? "Go!" : mmss(left);
    $("#restLabel").textContent = over >= 0 ? "Rest over, next set" : "Rest";
    $("#restFill").style.width = `${Math.min(100, (1 - left / r.total) * 100)}%`;
  }

  // ---------- keep screen awake during a workout ----------
  let wakeLock = null, wakeBusy = false;
  async function syncWakeLock() {
    const want = !!db.active && db.settings.wakeLock !== false && document.visibilityState === "visible";
    if (wakeBusy || !("wakeLock" in navigator) || want === !!wakeLock) return;
    wakeBusy = true;
    try {
      if (want) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      } else { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; } // denied (e.g. low battery mode): the screen just locks as usual
    wakeBusy = false;
  }

  // ---------- views ----------
  function render() {
    syncRest(); syncWakeLock();
    document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === ui.tab));
    const tabT = TX().tab, awardsTab = $('.tabbar [data-tab="awards"]');
    if (awardsTab) awardsTab.innerHTML = `<span>${tabT.icon}</span>${esc(tabT.label)}`;
    const views = { workout: viewWorkout, food: viewFood, history: viewHistory, awards: viewAwards, settings: viewSettings };
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
    h += homeGoals();

    h += `<section class="card"><div class="row-between"><h2>Routines</h2><button class="btn sm" data-act="newRoutine">+ New</button></div>`;
    if (!db.routines.length) h += `<p class="muted">No routines yet. Make one like “Push” or “Upper A” so its exercises load automatically.</p>`;
    for (const r of db.routines) {
      h += `<div class="list-item" data-act="editRoutine" data-id="${r.id}"><div><b>${esc(r.name)}</b><div class="muted small">${r.exerciseIds.map((id) => esc(exById(id)?.name || "?")).join(" · ") || "empty"}</div></div><span class="chev">›</span></div>`;
    }
    h += `</section>`;

    h += `<section class="card"><div class="row-between"><h2>Exercises</h2><button class="btn sm" data-act="newExercise">+ New</button></div>`;
    if (!db.exercises.length) h += `<p class="muted">No exercises yet.</p>`;
    for (const e of sortedExercises()) {
      h += `<div class="list-item" data-act="editExercise" data-id="${e.id}"><div><b>${esc(e.name)}</b>${builtIn(e)}${roLine(e)}<div class="muted small">${exSub(e)}</div></div><span class="chev">›</span></div>`;
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

  const STATUS = { new: "New", increase: "▲ Go up", build: "Target", struggling: "Hold", deload: "▼ Deload" };

  function targetText(targets) {
    const ws = [...new Set(targets.map((t) => t.w))];
    const reps = targets.map((t) => t.r).join(" / ");
    if (ws.length === 1) return `${ws[0] == null ? "?" : fmt(ws[0]) + " " + unit()} × ${reps}`;
    return targets.map((t) => `${fmt(t.w)}×${t.r}`).join(", ");
  }

  const cardioTargetText = (ex, t) => `${t.min} min${t.int != null ? ` @ ${fmt(t.int)} ${esc(ex.intLabel)}` : ""}`;
  // Cardio log rows: minutes, intensity, distance (+ watts on a bike). Running distance fills itself from speed × time.
  function cardioRows(ex, en, ei, sug) {
    const bike = ex.cardio === "bike";
    let h = `<div class="sets"><div class="set cardio ${bike ? "w4" : ""} head"><span>#</span><span>min</span><span>${esc(ex.intLabel)}</span><span>km</span>${bike ? "<span>watts</span>" : ""}<span></span></div>`;
    en.sets.forEach((s, si) => {
      const t = effTarget(en, si, sug);
      const inp = (k, ph, mode = "decimal") => `<input inputmode="${mode}" autocomplete="off" data-bind="${k}" data-ei="${ei}" data-si="${si}" value="${fmt(s[k])}" placeholder="${ph}">`;
      const kmPh = ex.cardio === "run" && t.int ? fmt(Math.round(t.int * t.min / 6) / 10) : "opt.";
      h += `<div class="set cardio ${bike ? "w4" : ""} ${s.done ? "done" : ""}"><span class="n">${isPR(ex.id, s) ? "🏆" : si + 1}</span>
        ${inp("min", t.min ?? "–", "numeric")}${inp("int", t.int == null ? "–" : fmt(t.int))}${inp("km", kmPh)}${bike ? inp("watts", "opt.", "numeric") : ""}
        <button class="check" data-act="toggleSet" data-ei="${ei}" data-si="${si}" aria-label="Complete">✓</button></div>`;
    });
    h += `</div><div class="row gap"><button class="btn sm" data-act="addSet" data-ei="${ei}">+ Interval</button>`;
    if (en.sets.length > 1) h += `<button class="btn sm ghost" data-act="removeSet" data-ei="${ei}">− Interval</button>`;
    h += `</div>${bike ? `<p class="muted small">Watts (avg, from the bike's screen) on a 20+ min ride give you a real-world rank.</p>` : ""}`;
    return h;
  }

  function entryCard(en, ei) {
    const { ex, last, lastSets, sug } = suggestionFor(en.exerciseId);
    if (!ex) return "";
    const rec = Progression.records(db.sessions, ex.id);
    const done = en.sets.filter((s) => s.done).length;
    const cardio = isCardio(ex);
    const sub = cardio
      ? `${ex.durMin}–${ex.durMax} min · then +${fmt(ex.intStep)} ${esc(ex.intLabel)}`
      : `${ex.sets}×${ex.repMin}–${ex.repMax} · +${fmt(ex.inc)} ${unit()}${rec.maxE ? ` · best e1RM ${fmt(Math.round(rec.maxE * 10) / 10)}` : ""}${Standards.STRENGTH[ex.std]?.unit === "db" ? " · log ONE dumbbell" : ""}`;
    let h = `<section class="card ex ${en.sets.length && done === en.sets.length ? "complete" : ""}">
      <div class="row-between"><h2>${esc(ex.name)}${lvlBadge(ex.id)}</h2><button class="icon" data-act="removeEntry" data-ei="${ei}" aria-label="Remove exercise">✕</button></div>
      <div class="muted small">${sub}</div>`;
    // Machine taken? Offer the exercise's substitutes (built-in swap groups) that aren't already in this workout.
    const subs = (ex.substitutes || []).filter((id) => exById(id) && !db.active.entries.some((x) => x.exerciseId === id));
    if (subs.length) h += `<div class="swap small"><span class="muted">⇄ Swap for</span>${subs.map((id) => `<button class="chip" data-act="swapEx" data-ei="${ei}" data-id="${id}">${esc(exById(id).name)}</button>`).join("")}</div>`;
    if (last) h += `<div class="last"><span class="label">Last · ${fmtDate(last.session.date)}</span>${lastSets.map((s) => fmtSet(ex, s)).join(", ")}</div>`;
    h += `<div class="target ${sug.status}"><span class="label">${STATUS[sug.status]}</span>${cardio ? cardioTargetText(ex, sug.targets[0]) : targetText(sug.targets)}<div class="small note">${esc(sug.note)}</div></div>`;
    if (cardio) return h + cardioRows(ex, en, ei, sug) + `</section>`;
    h += `<div class="sets"><div class="set head"><span>#</span><span>${unit()}</span><span>reps</span><span></span></div>`;
    en.sets.forEach((s, si) => {
      const t = effTarget(en, si, sug);
      const pr = isPR(ex.id, s);
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
    if (day === Store.dayKey()) h += bodySummary();
    h += `<section class="card">
      <div class="kcal"><span class="big-num">${r0(tot.kcal)}</span><span class="muted"> / ${r0(g.kcal)} kcal</span></div>
      <div class="small ${left < 0 ? "over" : "muted"}">${left >= 0 ? `${r0(left)} kcal left` : `${r0(-left)} kcal over`}</div>
      <div class="bar kc"><i style="width:${g.kcal ? Math.min(100, (tot.kcal / g.kcal) * 100) : 0}%"></i></div>
      ${bar("Protein", tot.p, g.p, "p")}${bar("Carbs", tot.c, g.c, "c")}${bar("Fat", tot.f, g.f, "f")}
    </section>`;
    h += `<div class="row gap"><button class="btn primary grow big" data-act="openFoodPicker">+ Add food</button><button class="btn big" data-act="quickAdd">Quick add</button></div>`;
    const today = Store.dayKey(), isToday = day === today;
    const prevDay = Store.shiftDay(day, -1), prevCount = db.foodLog.filter((e) => e.day === prevDay).length;
    h += `<section class="card"><h2>Entries</h2>`;
    if (!entries.length) h += `<p class="muted">Nothing logged ${isToday ? "yet today" : "this day"}.</p>`;
    for (const e of entries) {
      const food = e.foodId ? foodById(e.foodId) : null;
      const q = e.foodId ? (food && food.per === "100g" ? `${fmt(e.qty)} g` : `${fmt(e.qty)} serv`) : "";
      h += `<div class="list-item static"><div><b>${esc(e.name)}</b> <span class="muted small">${q}</span><div class="muted small">${r0(e.kcal)} kcal · P ${r0(e.p)} · C ${r0(e.c)} · F ${r0(e.f)}</div></div><span class="row">
        ${isToday ? "" : `<button class="icon" data-act="relogEntry" data-id="${e.id}" aria-label="Log again today" title="Log again today">↻</button>`}
        <button class="icon" data-act="delLog" data-id="${e.id}" aria-label="Delete entry">✕</button></span></div>`;
    }
    const copyBtns = [];
    if (!isToday && entries.length) copyBtns.push(`<button class="btn sm" data-act="copyDayToToday">⧉ Copy this day to today</button>`);
    if (prevCount) copyBtns.push(`<button class="btn sm ghost" data-act="copyPrevDay">⧉ Copy ${isToday ? "yesterday" : "previous day"} (${prevCount})</button>`);
    if (copyBtns.length) h += `<div class="row gap wrap mt">${copyBtns.join("")}</div>`;
    h += `</section>`;
    return h;
  }

  function spark(vals, label = "est. 1RM trend", digits = 0) {
    if (vals.length < 2) return `<p class="muted small">The trend chart appears after 2 entries.</p>`;
    const W = 300, H = 80, pad = 6, min = Math.min(...vals), max = Math.max(...vals);
    const x = (i) => pad + (i * (W - 2 * pad)) / (vals.length - 1);
    const y = (v) => (max === min ? H / 2 : H - pad - ((v - min) * (H - 2 * pad)) / (max - min));
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const r = (v) => fmt(Math.round(v * 10 ** digits) / 10 ** digits);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${esc(label)}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>
      <div class="row-between muted small"><span>${r(min)}</span><span>${esc(label)}</span><span>${r(max)}</span></div>`;
  }

  function viewHistory() {
    let h = `<h1>History</h1><div class="seg"><button class="${ui.histMode === "exercise" ? "on" : ""}" data-act="histMode" data-v="exercise">By exercise</button><button class="${ui.histMode === "sessions" ? "on" : ""}" data-act="histMode" data-v="sessions">Sessions</button></div>`;
    if (ui.histMode === "sessions") {
      if (!db.sessions.length) return h + `<p class="muted center">No finished workouts yet.</p>`;
      for (const s of [...db.sessions].reverse()) {
        const rn = db.routines.find((r) => r.id === s.routineId)?.name || "Workout";
        h += `<section class="card"><div class="row-between"><h2>${esc(rn)} <span class="muted small">${fmtDate(s.date)}</span></h2><span class="row"><button class="btn sm ghost" data-act="editSession" data-id="${s.id}">Edit</button><button class="icon" data-act="delSession" data-id="${s.id}" aria-label="Delete session">✕</button></span></div>`;
        for (const e of s.entries) { const ex = exById(e.exerciseId); h += `<div class="small"><b>${esc(ex?.name || "(deleted)")}</b>: ${e.sets.map((x) => fmtSet(ex, x)).join(", ")}</div>`; }
        h += `</section>`;
      }
      return h;
    }
    if (ui.histEx && exById(ui.histEx)) {
      const ex = exById(ui.histEx);
      h += `<button class="btn sm ghost" data-act="histBack">‹ All exercises</button>`;
      if (isCardio(ex)) return h + cardioDetail(ex);
      const rec = Progression.records(db.sessions, ex.id);
      h += `<section class="card"><div class="row-between"><h2>${esc(ex.name)}</h2><button class="btn sm" data-act="editExercise" data-id="${ex.id}">Edit</button></div>
        <div class="stats"><div><span class="muted small">Heaviest</span><b>${fmt(rec.maxW)} ${unit()}</b></div><div><span class="muted small">Best e1RM</span><b>${fmt(Math.round(rec.maxE * 10) / 10)} ${unit()}</b></div><div><span class="muted small">Sessions</span><b>${rec.history.length}</b></div></div>
        ${spark(rec.history.map((x) => x.e1rm))}</section>${rankCard(ex.id)}${levelCard(ex.id)}`;
      for (const x of [...rec.history].reverse()) {
        h += `<div class="list-item static"><div><b>${fmtDate(x.date)}</b><div class="small">${x.sets.map((s) => fmtSet(ex, s)).join(", ")}</div></div><span class="muted small">e1RM ${fmt(Math.round(x.e1rm))}</span></div>`;
      }
      return h;
    }
    // Every exercise with history (strength or cardio), most recently trained first.
    const lastDone = (id) => Progression.lastEntry(db.sessions, id);
    const rows = sortedExercises().map((e) => ({ e, last: lastDone(e.id) })).filter((x) => x.last);
    if (!rows.length) return h + `<p class="muted center">Finish a workout to see progress here.</p>`;
    rows.sort((a, b) => b.last.session.date.localeCompare(a.last.session.date));
    for (const { e, last } of rows) {
      let info;
      if (isCardio(e)) info = `last ${fmtDate(last.session.date)} · ${Progression.doneCardio(last.entry).map((s) => fmtSet(e, s)).join(", ")}`;
      else { const rec = Progression.records(db.sessions, e.id); info = `last ${fmtDate(last.session.date)} · top ${fmt(rec.maxW)} ${unit()} · e1RM ${fmt(Math.round(rec.maxE))}`; }
      h += `<div class="list-item" data-act="histEx" data-id="${e.id}"><div><b>${esc(e.name)}</b>${lvlBadge(e.id)}<div class="muted small">${esc(info)}</div></div><span class="chev">›</span></div>`;
    }
    return h;
  }

  function cardioDetail(ex) {
    const hist = [];
    for (const s of db.sessions) {
      const e = s.entries.find((x) => x.exerciseId === ex.id);
      const bouts = Progression.doneCardio(e);
      if (bouts.length) hist.push({ date: s.date, bouts, score: Math.max(...bouts.map((b) => Progression.cardioScore(ex, b))), min: bouts.reduce((n, b) => n + b.min, 0) });
    }
    const run = ex.cardio === "run";
    const best5k = run ? Math.min(...hist.flatMap((x) => x.bouts.map((b) => Standards.fiveKEquivalent(Progression.cardioKm(ex, b), b.min) || Infinity))) : Infinity;
    const maxW = Math.max(0, ...hist.flatMap((x) => x.bouts.map((b) => b.watts || 0)));
    const stat3 = run ? `<div><span class="muted small">Best 5K equiv.</span><b>${isFinite(best5k) ? mmssLong(best5k) : "–"}</b></div>`
      : ex.cardio === "bike" ? `<div><span class="muted small">Best avg power</span><b>${maxW ? maxW + " W" : "–"}</b></div>`
      : `<div><span class="muted small">Top ${esc(ex.intLabel)}</span><b>${fmt(Math.max(0, ...hist.flatMap((x) => x.bouts.map((b) => b.int || 0))))}</b></div>`;
    let h = `<section class="card"><div class="row-between"><h2>${esc(ex.name)}</h2><button class="btn sm" data-act="editExercise" data-id="${ex.id}">Edit</button></div>
      <div class="stats"><div><span class="muted small">Sessions</span><b>${hist.length}</b></div><div><span class="muted small">Longest</span><b>${Math.max(0, ...hist.map((x) => x.min))} min</b></div>${stat3}</div>
      ${spark(hist.map((x) => x.score), run ? "5K-equivalent speed (km/h)" : `minutes × ${ex.intLabel}`, run ? 1 : 0)}</section>${rankCard(ex.id)}${levelCard(ex.id)}`;
    for (const x of [...hist].reverse()) h += `<div class="list-item static"><div><b>${fmtDate(x.date)}</b><div class="small">${x.bouts.map((b) => fmtSet(ex, b)).join(", ")}</div></div></div>`;
    return h;
  }

  // ---------- achievements ----------
  // Cached between saves: compute() walks all history once, which is cheap but needn't run per card.
  // persist() clears it, so any change (edited rep range, deleted session, restored backup) is picked up.
  function ach() {
    if (!achCache) achCache = Achievements.compute(db);
    return achCache;
  }
  const pct = (x) => `${Math.round(x * 100)}%`;
  // Active progression theme (names/icons/wording). Mechanics are the same for every theme.
  const T = () => Themes.get(db.settings.theme);
  const TX = () => T().text;
  const famText = (id) => T().families[id];
  const famDesc = (id, n) => famText(id).desc(n, Achievements.C);
  const tierChip = (t) => (t ? `<span class="tier" style="--t:${t.color}">${esc(t.name)}</span>` : `<span class="tier locked">${esc(TX().locked)}</span>`);
  const lvl = (n) => `<span class="lvl">${esc(TX().levelWord)} ${n}</span>`;
  // Would this logged set be a PR? Same rules as Achievements: weighted = beats best e1RM or top weight,
  // bodyweight (0) = more reps than ever. A first-ever session sets the baseline, so it's never a PR.
  function isPR(exId, s) {
    const st = ach().ex.get(exId);
    if (!s.done || !st) return false;
    const ex = exById(exId);
    if (isCardio(ex)) return st.w.first > 0 && Progression.cardioScore(ex, s) > st.w.best + 0.01;
    if (s.w > 0) return st.w.first > 0 && (Progression.e1rm(s.w, s.r) > st.w.best + 0.01 || s.w > st.w.maxW + 0.01);
    return st.bw.first > 0 && s.r > st.bw.maxR;
  }
  // Exercises with a real-world standard show their rank tier; the rest show their relative level.
  function lvlBadge(exId) {
    const r = rk().ex.get(exId);
    if (r) return ` ${tierChip(T().tiers[r.tier - 1])}`;
    const st = ach().ex.get(exId);
    return st ? ` ${lvl(st.level)}` : "";
  }

  // ---------- real-world ranks ----------
  function rk() {
    if (!rankCache) rankCache = Ranks.compute(db);
    return rankCache;
  }
  const pctText = (p) => (p >= 99.5 ? "99%+" : p < 1 ? "<1%" : `${Math.round(p)}%`);
  const mmssLong = (sec) => { const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? h + ":" + String(m).padStart(2, "0") : m}:${String(s % 60).padStart(2, "0")}`; };
  const sexWord = () => (db.settings.profile?.sex === "f" ? "women" : "men");
  function rankLine(r) {
    if (r.type === "strength") return `Stronger than ${pctText(r.p)} of ${sexWord()} who log this lift, at your bodyweight`;
    if (r.type === "run") return `Faster than ${pctText(r.p)} of ${sexWord()} runners your age · 5K ≈ ${mmssLong(r.value)}`;
    return `FTP ≈ ${fmt(Math.round(r.wkg * 100) / 100)} W/kg · Coggan rating “${r.label}”`;
  }
  function rankNextText(r, ex) {
    if (!r.next) return "Top tier reached.";
    const name = T().tiers[r.next.tier - 1].name;
    if (r.type === "strength") {
      if (r.unit === "reps") return `Next: ${name} at ${r.next.value} bodyweight reps`;
      const one = Math.ceil(r.next.value * 2) / 2, reps = ex.repMin || 8, work = Math.ceil((r.next.value / (1 + reps / 30)) * 2) / 2;
      return `Next: ${name} at est. 1RM ${fmt(one)} ${unit()}${r.unit === "db" ? " (one dumbbell)" : ""} ≈ ${fmt(work)} × ${reps}`;
    }
    if (r.type === "run") return `Next: ${name} at a 5K of ${mmssLong(r.next.t5k)}`;
    return `Next: ${name} at ${fmt(Math.round(r.next.wkg * 100) / 100)} W/kg ≈ ${Math.round(r.next.watts)} W average for 20+ min`;
  }
  function rankRow(r, clickable) {
    const ex = exById(r.exerciseId);
    if (!ex) return "";
    return `<div class="list-item ${clickable ? "" : "static"}" ${clickable ? `data-act="histExFromAwards" data-id="${ex.id}"` : ""}><div class="grow">
      <div class="row-between"><b>${esc(ex.name)}</b>${tierChip(T().tiers[r.tier - 1])}</div>
      <div class="small">${esc(rankLine(r))}</div>
      ${r.p != null ? `<div class="bar sm rk"><i style="width:${Math.min(100, Math.max(2, r.p))}%"></i></div>` : ""}
      <div class="muted small">${esc(rankNextText(r, ex))} · best on ${fmtDate(r.date)}</div></div></div>`;
  }
  function rankCard(exId) {
    const ex = exById(exId);
    const r = rk().ex.get(exId);
    if (r) return `<section class="card"><h2>Real-world rank</h2>${rankRow(r, false)}</section>`;
    const missing = rk().missing;
    const hasStd = (ex.std && Standards.STRENGTH[ex.std]) || ex.cardio === "run" || ex.cardio === "bike";
    if (hasStd && missing.length) return `<section class="card"><h2>Real-world rank</h2><p class="muted small">Add your ${missing.join(", ")} to see how this compares to real people.</p><button class="btn sm" data-act="openBody">Body stats</button></section>`;
    return "";
  }

  function nextLevelText(st) {
    if (!st.next) return "";
    if (st.next.cardio) return "Next level at +5% (go longer, or harder)";
    if (st.next.e1rm != null) return `Next level at est. 1RM ${fmt(Math.ceil(st.next.e1rm * 10) / 10)} ${unit()}`;
    return `Next level at ${st.next.reps} reps (bodyweight)`;
  }
  function levelCard(exId) {
    const st = ach().ex.get(exId);
    if (!st) return "";
    return `<section class="card"><div class="row-between"><h2>${lvl(st.level)}</h2><span class="muted small">+${Math.floor(st.gain * 100)}% vs first session</span></div>
      <div class="bar lv"><i style="width:${pct(st.levelProgress)}"></i></div>
      <div class="muted small">${esc(nextLevelText(st))} · ${st.prs} PRs · ${st.clears}× top of range</div></section>`;
  }
  function closest(n) {
    return ach().families.filter((f) => f.next != null).sort((a, b) => b.bandProgress - a.bandProgress).slice(0, n);
  }
  function famRow(f) {
    const ft = famText(f.id);
    const goal = f.next != null ? famDesc(f.id, f.next) : TX().maxed;
    const val = f.id === "gain" ? `${f.value}%` : f.value;
    return `<div class="ach"><div class="ach-ic">${ft.icon}</div><div class="grow">
      <div class="row-between"><b>${esc(ft.name)}</b>${tierChip(T().tiers[f.tier - 1])}</div>
      <div class="muted small">${esc(goal)}</div>
      ${f.next != null ? `<div class="bar sm"><i style="width:${pct(f.progress)}"></i></div><div class="muted small">${val} / ${f.id === "gain" ? f.next + "%" : f.next}</div>` : ""}
      <div class="pips">${f.tiers.map((_, i) => `<i class="${i < f.tier ? "on" : ""}" style="--t:${T().tiers[i].color}"></i>`).join("")}</div>
    </div></div>`;
  }
  function homeGoals() {
    const a = ach();
    if (!a.stats.sessions) return "";
    const s = a.stats;
    const f = closest(1)[0];
    const o = rk().overall;
    return `<section class="card"><div class="row-between"><h2>${esc(TX().streak(s.currentStreak))}</h2><span class="muted small">this week ${Math.min(s.thisWeek, Achievements.WEEKLY_TARGET)}/${Achievements.WEEKLY_TARGET} · best ${s.bestStreak} wk</span></div>
      <div class="muted small">Missing a week only resets this counter. Ranks and badges are permanent.</div>
      ${o ? `<div class="small mt">Strength rank ${tierChip(T().tiers[o.tier - 1])} stronger than ${pctText(o.p)} of lifters</div>` : ""}
      ${f ? `<div class="muted small mt">${esc(TX().nextUp)}: ${famText(f.id).icon} ${esc(famText(f.id).name)} — ${esc(famDesc(f.id, f.next))}</div><div class="bar sm"><i style="width:${pct(f.progress)}"></i></div>` : ""}
      <button class="btn sm ghost" data-act="goAwards">${esc(TX().title)} ›</button></section>`;
  }

  function rankSection() {
    const R = rk();
    let h = `<section class="card" id="rankCard"><h2>Real-world rank</h2>`;
    if (R.missing.includes("sex") || R.missing.includes("bodyweight")) {
      return h + `<p class="muted small">Ranks compare your best lifts and runs with real people of your sex, bodyweight and age. Add your body stats to unlock them.</p><button class="btn sm primary" data-act="openBody">Add body stats</button></section>`;
    }
    if (R.overall) {
      h += `<div class="rank-hero">${tierChip(T().tiers[R.overall.tier - 1])}<div class="big-num">${pctText(R.overall.p)}</div>
        <div class="muted small">Overall strength: stronger than ${pctText(R.overall.p)} of lifters (average of your best ${R.overall.count} lift${R.overall.count === 1 ? "" : "s"})</div></div>`;
    }
    const rows = [...R.ex.values()].sort((a, b) => b.tier - a.tier || (b.p ?? 0) - (a.p ?? 0));
    if (!rows.length) h += `<p class="muted small">Log a ranked lift, a run, or a bike ride with watts to get your first rank.</p>`;
    h += rows.map((r) => rankRow(r, true)).join("");
    if (R.missing.includes("age")) h += `<p class="muted small">Add your age in body stats to rank your runs.</p>`;
    const legend = T().tiers.map((t, i) => `${t.name}${i ? ` = top ${100 - Standards.TIER_P[i]}%` : " = everyone"}`).join(" · ");
    h += `<p class="muted small">${esc(legend)}</p>
      <details class="small muted"><summary>Where these numbers come from</summary>
        <p>Lifts: Strength Level standards, built from about 46 million lifts logged by its users (2015–2026). People who log their lifts are stronger than the average person, so these percentages compare you with gym-goers, not with everyone. Beating 50% here already puts you well above the general population.</p>
        <p>Runs: Running Level 5K times by age and sex (about 68,000 race results). Your run is converted to a 5K-equivalent time (Riegel formula), so a steady treadmill run counts as a conservative estimate.</p>
        <p>Bike: there's no reliable percentile data for cycling, so your FTP (from average watts) is graded with Allen &amp; Coggan's categories, which top out at Superior (tier 5).</p>
        <p>Your rank is your best ever, judged at the bodyweight you had that day. Skipping exercises or weeks never lowers it.</p></details></section>`;
    return h;
  }

  function viewAwards() {
    const a = ach(), X = TX();
    const total = a.families.reduce((n, f) => n + f.tiers.length, 0) + a.feats.length;
    const earned = a.earnedIds.size;
    let h = `<div class="row-between"><h1>${esc(X.title)}</h1><button class="btn sm ghost" data-act="goTheme">${T().icon} ${esc(T().name)}</button></div>`;
    h += `<section class="card"><div class="stats">
      <div><span class="muted small">Streak</span><b>${esc(X.streakShort(a.stats.currentStreak))}</b></div>
      <div><span class="muted small">${esc(X.prs)}</span><b>${X.prsIcon} ${a.stats.prs}</b></div>
      <div><span class="muted small">Unlocked</span><b>${earned} / ${total}</b></div></div>
      <div class="bar"><i style="width:${pct(earned / total)}"></i></div>
      <p class="muted small">Badges count your own training: workouts, PRs and progress against your first session. They never go down, and custom exercises count the same as built-in ones.</p></section>`;
    h += rankSection();
    if (!a.stats.sessions) return h + `<p class="muted center">${esc(X.empty)}</p>`;
    h += `<section class="card"><h2>${esc(X.closest)}</h2>${closest(3).map(famRow).join("")}</section>`;
    h += `<section class="card"><h2>${esc(X.families)}</h2>${a.families.map(famRow).join("")}</section>`;
    h += `<section class="card"><h2>${esc(X.feats)}</h2>${a.feats.map((f) => {
      const ft = T().feats[f.id];
      return `<div class="ach ${f.earned ? "" : "dim"}"><div class="ach-ic">${ft.icon}</div><div class="grow"><div class="row-between"><b>${esc(ft.name)}</b>${f.earned ? `<span class="tier" style="--t:var(--accent)">${esc(X.done)}</span>` : tierChip(null)}</div><div class="muted small">${esc(ft.desc)}</div></div></div>`;
    }).join("")}</section>`;
    const rows = [...a.ex.values()].filter((st) => exById(st.id)).sort((x, y) => y.level - x.level || y.gain - x.gain);
    h += `<section class="card"><h2>${esc(X.levels)}</h2><p class="muted small">${esc(X.levelsIntro(Math.round(Achievements.LEVEL_STEP * 100)))}</p>`;
    for (const st of rows) {
      const e = exById(st.id);
      h += `<div class="list-item" data-act="histExFromAwards" data-id="${e.id}"><div class="grow"><div class="row-between"><b>${esc(e.name)}</b>${lvl(st.level)}</div>
        <div class="bar sm lv"><i style="width:${pct(st.levelProgress)}"></i></div>
        <div class="muted small">+${Math.floor(st.gain * 100)}% · ${esc(nextLevelText(st))}</div></div></div>`;
    }
    h += `</section>`;
    return h;
  }

  function themePicker() {
    const cur = T().id;
    return `<section class="card" id="themeCard"><h2>Progression theme</h2>
      <p class="muted small">Changes names and looks only. What you've earned stays the same.</p><div class="stack">
      ${Themes.list.map((t) => `<div class="list-item theme ${t.id === cur ? "on" : ""}" data-act="setTheme" data-v="${t.id}">
        <div class="ach-ic">${t.icon}</div><div class="grow"><b>${esc(t.name)}</b><div class="muted small">${esc(t.tagline)}</div>
        <div class="pips tiers">${t.tiers.map((x) => `<span class="tier" style="--t:${x.color}">${esc(x.name)}</span>`).join("")}</div></div>
        <span class="chev">${t.id === cur ? "✓" : ""}</span></div>`).join("")}</div></section>`;
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
      <section class="card"><h2>Workout</h2>
        <div class="row-between"><span>Rest timer after each set</span><div class="seg compact"><button class="${restCfg().on ? "on" : ""}" data-act="setRestOn" data-v="1">On</button><button class="${restCfg().on ? "" : "on"}" data-act="setRestOn" data-v="0">Off</button></div></div>
        <label class="mt">Default rest (seconds)<input inputmode="numeric" data-restsec value="${restCfg().sec}"></label>
        <p class="muted small">Each exercise can override this in its settings. Your phone vibrates (Android) and beeps when rest is over.</p>
        <div class="row-between mt"><span>Keep screen on during workouts</span><div class="seg compact"><button class="${db.settings.wakeLock !== false ? "on" : ""}" data-act="setWake" data-v="1">On</button><button class="${db.settings.wakeLock === false ? "on" : ""}" data-act="setWake" data-v="0">Off</button></div></div>
      </section>
      ${bodySummary()}
      ${themePicker()}
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
    h += list.map((e) => `<div class="list-item" data-act="pickEx" data-id="${e.id}"><div><b>${esc(e.name)}</b>${builtIn(e)}${roLine(e)}<div class="muted small">${exSub(e)}</div></div>${taken.includes(e.id) ? `<span class="muted small">added</span>` : `<span class="chev">+</span>`}</div>`).join("");
    if (!db.exercises.length && !q) h += `<p class="muted">No exercises yet. Type a name to create one.</p>`;
    return h;
  }

  function baselineInfo(e) {
    const muscles = [...e.primary, ...e.secondary.map((x) => `${x} (secondary)`)].join(", ");
    const subs = (e.substitutes || []).map((id) => exById(id)?.name).filter(Boolean);
    // "core" is only a suggestion of where to start: nothing is required and skipping an exercise costs nothing.
    const group = { core: "Main exercise", accessory: "Add-on", cardio: "Cardio" }[e.tier] || e.tier;
    const std = Standards.STRENGTH[e.std];
    const ranked = std ? `${std.name}${std.unit === "db" ? ", one dumbbell" : ""} (Strength Level data)`
      : e.cardio === "run" ? "runners your age (Running Level data)" : e.cardio === "bike" ? "Coggan FTP categories (needs watts)" : "";
    return `<div class="info small">
      <div><span class="badge">Built-in</span> <span class="muted">${esc(group)} · optional · can't be deleted</span></div>
      ${ranked ? `<div><span class="muted">Ranked against:</span> ${esc(ranked)}</div>` : ""}
      <div><span class="muted">Romanian:</span> ${esc(e.name_ro)}</div>
      <div><span class="muted">Muscles:</span> ${esc(muscles)}</div>
      <div><span class="muted">Pattern:</span> ${esc(e.pattern)} · <span class="muted">Equipment:</span> ${esc(e.equipment)}</div>
      ${subs.length ? `<div><span class="muted">Can swap with:</span> ${subs.map(esc).join(", ")}</div>` : ""}
    </div>`;
  }

  const kindSwitch = (cur) => `<div class="seg"><button type="button" class="${cur === "strength" ? "on" : ""}" data-act="exKind" data-v="strength">Strength</button><button type="button" class="${cur === "cardio" ? "on" : ""}" data-act="exKind" data-v="cardio">Cardio</button></div>`;
  function cardioForm(m) {
    const ex = m.id ? exById(m.id) : null;
    const type = ex ? ex.cardio || "other" : m.cardio || "run";
    const e = ex || { name: m.name || "", ...CARDIO_TYPES[type] };
    const locked = ex && ex.is_baseline;
    return {
      title: m.id ? "Edit cardio" : "New exercise",
      body: `<form id="mform" class="stack">
        ${m.id ? "" : kindSwitch("cardio")}
        <label>Name<input name="name" required value="${esc(e.name)}" ${m.id ? "" : "autofocus"}></label>
        <label>Type<select name="cardio" ${locked ? "disabled" : ""}>${Object.entries(CARDIO_TYPES).map(([k, t]) => `<option value="${k}" ${k === type ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></label>
        <div class="grid2"><label>Min duration (min)<input name="durMin" inputmode="numeric" value="${e.durMin}"></label><label>Max duration (min)<input name="durMax" inputmode="numeric" value="${e.durMax}"></label></div>
        <div class="grid2"><label>Intensity is measured in<input name="intLabel" value="${esc(e.intLabel)}"></label><label>Raise intensity by<input name="intStep" inputmode="decimal" value="${fmt(e.intStep)}"></label></div>
        <p class="muted small">Cardio progression: each session goes ~10% longer at the same intensity. Once you reach the max duration, the intensity goes up by the step and the time drops back to the min.
        ${type === "run" ? " Running speed + time also gives you a real-world rank against runners your age." : type === "bike" ? " Log the bike's average watts to get a real-world rank." : " This type has no real-world ranking, but it still earns levels, PRs and awards."}</p>
        ${locked ? baselineInfo(ex) : ""}
        <button class="btn primary big" type="submit">Save</button>
        ${m.id && !locked ? `<button type="button" class="btn danger" data-act="deleteExercise" data-id="${m.id}">Delete exercise</button>` : ""}
      </form>`,
    };
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

  // ---------- body stats: BMI + calorie needs ----------
  const ACTIVITY = [
    { id: "sedentary", f: 1.2, label: "Sedentary: desk job, little exercise" },
    { id: "light", f: 1.375, label: "Light: training 1–3 days/week" },
    { id: "moderate", f: 1.55, label: "Moderate: training 3–5 days/week" },
    { id: "very", f: 1.725, label: "Very active: training 6–7 days/week" },
    { id: "extra", f: 1.9, label: "Extra active: physical job + training" },
  ];
  const GOALS = [
    { id: "cut-fast", d: -550, label: "Lose ~0.5 kg/week" },
    { id: "cut", d: -275, label: "Lose ~0.25 kg/week" },
    { id: "maintain", d: 0, label: "Maintain weight" },
    { id: "bulk", d: 275, label: "Gain ~0.25 kg/week (lean bulk)" },
  ];
  const profile = () => db.settings.profile || {};
  const ageOf = (p) => (p.born ? new Date().getFullYear() - p.born : null);
  const toKgW = (w) => (unit() === "lb" ? w / Ranks.LB : w);
  const fromKgW = (kg) => (unit() === "lb" ? kg * Ranks.LB : kg);
  /**
   * BMI (WHO categories), BMR (Mifflin-St Jeor), daily needs (BMR × activity factor), a goal target
   * (±275/550 kcal ≈ 0.25/0.5 kg a week at ~7,700 kcal per kg), and macros: protein 1.8 g/kg
   * (ISSN range 1.6–2.2; from a BMI-25 weight if BMI ≥ 30), fat ≥ 25% of calories, carbs the rest.
   * The target never goes below BMR or 1,500/1,200 kcal (men/women).
   */
  function calcBody(v) {
    if (!(v.kg > 0 && v.heightCm > 0 && v.age > 0 && v.sex)) return null;
    const m = v.heightCm / 100, bmi = v.kg / (m * m);
    const cat = bmi < 18.5 ? "Underweight" : bmi < 25 ? "Healthy weight" : bmi < 30 ? "Overweight" : "Obese";
    const bmr = 10 * v.kg + 6.25 * v.heightCm - 5 * v.age + (v.sex === "m" ? 5 : -161);
    const tdee = bmr * (ACTIVITY.find((a) => a.id === v.activity) || ACTIVITY[2]).f;
    const goal = GOALS.find((g) => g.id === v.goal) || GOALS[2];
    const floor = Math.max(bmr, v.sex === "m" ? 1500 : 1200);
    let kcal = tdee + goal.d;
    const clamped = kcal < floor;
    if (clamped) kcal = floor;
    kcal = Math.round(kcal / 10) * 10;
    const refKg = bmi >= 30 ? 25 * m * m : v.kg;
    const p = Math.round(1.8 * refKg), f = Math.round(Math.max(0.6 * v.kg, (kcal * 0.25) / 9)), c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
    return { bmi, cat, bmr, tdee, kcal, clamped, p, c, f, healthy: [18.5 * m * m, 24.9 * m * m], goal };
  }
  function bodyVals(fd) {
    const born = num(fd.get("age")) > 0 ? new Date().getFullYear() - num(fd.get("age")) : null;
    return { sex: fd.get("sex"), age: num(fd.get("age")), born, heightCm: num(fd.get("height")), kg: num(fd.get("weight")) > 0 ? toKgW(num(fd.get("weight"))) : null, activity: fd.get("activity"), goal: fd.get("goal") };
  }
  function savedBody() {
    const p = profile(), kg = Ranks.currentBodyweight(db);
    return { ...p, age: ageOf(p), kg };
  }
  function bodyResults(v) {
    const r = calcBody(v);
    if (!r) return `<p class="muted small">Fill in sex, age, height and weight to see your numbers.</p>`;
    const kgTxt = (kg) => `${fmt(Math.round(fromKgW(kg)))} ${unit()}`;
    return `<div class="stats">
        <div><span class="muted small">BMI</span><b>${fmt(Math.round(r.bmi * 10) / 10)}</b><span class="small">${r.cat}</span></div>
        <div><span class="muted small">Maintenance</span><b>${Math.round(r.tdee / 10) * 10}</b><span class="small">kcal/day</span></div>
        <div><span class="muted small">Your target</span><b>${r.kcal}</b><span class="small">kcal/day</span></div></div>
      <div class="small">Suggested daily goals: <b>${r.kcal} kcal</b> · protein ${r.p} g · carbs ${r.c} g · fat ${r.f} g</div>
      <div class="muted small">At rest you burn ~${Math.round(r.bmr)} kcal. A healthy-BMI weight for your height is ${kgTxt(r.healthy[0])}–${kgTxt(r.healthy[1])}.${r.clamped ? " Your target was raised to a safe minimum; a slower pace is better here." : ""}</div>`;
  }
  function bodySummary() {
    const r = calcBody(savedBody());
    if (!r) return `<section class="card"><div class="row-between"><div><b>Body stats</b><div class="muted small">BMI, daily calorie needs, and real-world ranks</div></div><button class="btn sm primary" data-act="openBody">Set up</button></div></section>`;
    return `<section class="card"><div class="row-between"><div><b>BMI ${fmt(Math.round(r.bmi * 10) / 10)}</b> <span class="muted small">${r.cat}</span>
      <div class="muted small">Maintenance ~${Math.round(r.tdee / 10) * 10} kcal · target ${r.kcal} kcal (${esc(r.goal.label.toLowerCase())})</div></div>
      <button class="btn sm" data-act="openBody">Update</button></div></section>`;
  }

  // Re-log entries on another day as new entries (same snapshot of name/amount/macros).
  function copyFood(list, day) {
    for (const e of list) db.foodLog.push({ ...e, id: Store.uid(), day });
  }

  function scaleFood(f, qty) {
    const k = f.per === "100g" ? qty / 100 : qty;
    return { kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k };
  }
  const macroLine = (m) => `<b>${r0(m.kcal)} kcal</b> · P ${r0(m.p)} · C ${r0(m.c)} · F ${r0(m.f)}`;

  const MODALS = {
    celebrate() {
      const m = ui.modal, X = TX();
      const row = (u) => {
        const t = u.kind === "feat" ? T().feats[u.id] : famText(u.id);
        const desc = u.kind === "feat" ? t.desc : famDesc(u.id, Achievements.FAMILIES.find((f) => f.id === u.id).tiers[u.tier]);
        return `<div class="ach pop"><div class="ach-ic">${t.icon}</div><div class="grow"><div class="row-between"><b>${esc(t.name)}</b>${u.kind === "family" ? tierChip(T().tiers[u.tier]) : ""}</div><div class="muted small">${esc(desc)}</div></div></div>`;
      };
      let b = `<p class="muted">Saved: ${esc(m.summary)}.</p>`;
      if (m.rankUps?.length) {
        b += `<div class="card"><h2>Real-world rank ${m.rankUps.some((u) => u.from) ? "up" : ""}</h2>${m.rankUps.map((u) => `<div class="ach pop"><div class="grow">
          <div class="row-between"><b>${esc(exById(u.id)?.name || "?")}</b><span>${u.from ? `${tierChip(T().tiers[u.from - 1])} → ` : ""}${tierChip(T().tiers[u.to - 1])}</span></div>
          <div class="muted small">${esc(rankLine(u.r))}</div></div></div>`).join("")}</div>`;
      }
      if (m.unlocked.length) b +=`<div class="card"><h2>${esc(X.celebrateUnlocked)}</h2>${m.unlocked.map(row).join("")}</div>`;
      // Relative levels only for exercises without a real-world rank (the rank says more).
      const levelUps = m.levelUps.filter((l) => !rk().ex.has(l.id));
      if (levelUps.length) b += `<div class="card"><h2>${esc(X.celebrateLevelUp)}</h2>${levelUps.map((l) => `<div class="small"><b>${esc(exById(l.id)?.name || "?")}</b> · ${esc(X.levelWord)} ${l.from} → ${lvl(l.to)}</div>`).join("")}</div>`;
      if (m.prs.length) b += `<div class="card"><h2>${esc(X.celebratePRs)}</h2><div class="small">${m.prs.map(esc).join(", ")}</div></div>`;
      b += `<button class="btn primary big" data-act="closeModal">${esc(X.celebrateButton)}</button>`;
      return { title: X.celebrateTitle, body: b };
    },
    body() {
      const v = savedBody();
      const opt = (list, cur) => list.map((x) => `<option value="${x.id}" ${x.id === cur ? "selected" : ""}>${esc(x.label)}</option>`).join("");
      const w = db.weighIns || [];
      const hist = w.length >= 2 ? spark(w.slice(-30).map((x) => fromKgW(x.kg)), `weight (${unit()}), last ${Math.min(30, w.length)} weigh-ins`, 1) : "";
      return {
        title: "Body stats & calories",
        body: `<form id="mform" class="stack">
          <div class="grid2"><label>Sex<select name="sex"><option value="">–</option><option value="m" ${v.sex === "m" ? "selected" : ""}>Male</option><option value="f" ${v.sex === "f" ? "selected" : ""}>Female</option></select></label>
          <label>Age<input name="age" inputmode="numeric" value="${v.age ?? ""}"></label></div>
          <div class="grid2"><label>Height (cm)<input name="height" inputmode="numeric" value="${v.heightCm ?? ""}"></label>
          <label>Weight today (${unit()})<input name="weight" inputmode="decimal" value="${v.kg ? fmt(Math.round(fromKgW(v.kg) * 10) / 10) : ""}"></label></div>
          <label>Activity level<select name="activity">${opt(ACTIVITY, v.activity || "moderate")}</select></label>
          <label>Goal<select name="goal">${opt(GOALS, v.goal || "maintain")}</select></label>
          <div id="bodyOut" class="info">${bodyResults(v)}</div>
          <button class="btn primary big" type="submit">Save</button>
          <button class="btn" type="button" data-act="bodyApplyGoals">Save & use as my daily food goals</button>
          <p class="muted small">Saving logs today's weigh-in. Ranks use the weight you had on each workout day, so gaining weight later never lowers an old rank.
          BMI can't tell muscle from fat, so it can read high if you carry a lot of muscle. All numbers are estimates.</p>
          ${hist}
        </form>`,
      };
    },
    sessionEdit() {
      const d = ui.sessionDraft;
      let b = `<label>Date<input type="date" data-sdate value="${Store.dayKey(d.date)}" max="${Store.dayKey()}"></label>`;
      d.entries.forEach((e, ei) => {
        const ex = exById(e.exerciseId), c = isCardio(ex), bike = c && ex.cardio === "bike";
        const cls = c ? `set cardio ${bike ? "w4" : ""}` : "set";
        const inp = (s, si, k, mode = "decimal") => `<input inputmode="${mode}" autocomplete="off" data-sbind="${k}" data-ei="${ei}" data-si="${si}" value="${fmt(s[k])}">`;
        b += `<div class="card"><div class="row-between"><b>${esc(ex?.name || "(deleted exercise)")}</b><button class="icon" data-act="sRmEntry" data-ei="${ei}" aria-label="Remove exercise">✕</button></div>
          <div class="sets"><div class="${cls} head"><span>#</span>${c ? `<span>min</span><span>${esc(ex.intLabel)}</span><span>km</span>${bike ? "<span>watts</span>" : ""}` : `<span>${unit()}</span><span>reps</span>`}<span></span></div>`;
        e.sets.forEach((s, si) => {
          b += `<div class="${cls}"><span class="n">${si + 1}</span>
            ${c ? inp(s, si, "min", "numeric") + inp(s, si, "int") + inp(s, si, "km") + (bike ? inp(s, si, "watts", "numeric") : "") : inp(s, si, "w") + inp(s, si, "r", "numeric")}
            <button class="icon" data-act="sRmSet" data-ei="${ei}" data-si="${si}" aria-label="Remove set">✕</button></div>`;
        });
        b += `</div><button class="btn sm" data-act="sAddSet" data-ei="${ei}">+ Set</button></div>`;
      });
      if (!d.entries.length) b += `<p class="muted">No exercises left. Saving will delete this workout.</p>`;
      b += `<button class="btn primary big" data-act="saveSession">Save changes</button><p class="muted small center">Closing without saving discards your edits. Awards and levels update automatically.</p>`;
      return { title: "Edit workout", body: b };
    },
    exPicker() {
      return { title: "Add exercise", body: `<input class="search" type="search" placeholder="Search, or type a new name" data-search="ex" value="${esc(ui.modal.q)}" autofocus><div id="mlist" class="stack">${exPickerList()}</div>` };
    },
    exForm() {
      const m = ui.modal;
      const kind = m.id ? (exById(m.id).kind || "strength") : (m.kind || "strength");
      if (kind === "cardio") return cardioForm(m);
      const e = m.id ? exById(m.id) : { name: m.name || "", repMin: 8, repMax: 12, sets: 3, inc: unit() === "kg" ? 2.5 : 5 };
      const stdPick = e.is_baseline ? "" : `<label>Real-world rank: compare me to people doing…<select name="std"><option value="">Nothing (track my own progress only)</option>
        ${Standards.LIST.map((s) => `<option value="${s.id}" ${e.std === s.id ? "selected" : ""}>${esc(s.name)}${s.unit === "db" ? " (one dumbbell)" : s.unit === "reps" ? " (reps)" : ""}</option>`).join("")}</select></label>`;
      return {
        title: m.id ? "Edit exercise" : "New exercise",
        body: `<form id="mform" class="stack">
          ${m.id ? "" : kindSwitch("strength")}
          <label>Name<input name="name" required value="${esc(e.name)}" ${m.id ? "" : "autofocus"}></label>
          <div class="grid2"><label>Min reps<input name="repMin" inputmode="numeric" value="${e.repMin}"></label><label>Max reps<input name="repMax" inputmode="numeric" value="${e.repMax}"></label></div>
          <div class="grid2"><label>Sets<input name="sets" inputmode="numeric" value="${e.sets}"></label><label>Weight step (${unit()})<input name="inc" inputmode="decimal" value="${fmt(e.inc)}"></label></div>
          <div class="grid2"><label>Rest (seconds)<input name="rest" inputmode="numeric" value="${e.rest == null ? "" : e.rest}" placeholder="default ${restCfg().sec}"></label><span class="muted small rest-hint">Blank = your default from Settings. 0 = no timer.</span></div>
          <p class="muted small">Double progression: once you hit <b>max reps on every set</b>, the target weight goes up by the step and reps reset to min.</p>
          ${stdPick}
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

  function saveBody(fd, applyGoals) {
    const v = bodyVals(fd);
    if (!v.sex) return toast("Pick your sex (the standards differ)");
    if (!(v.age >= 13 && v.age <= 100)) return toast("Age must be 13–100");
    if (!(v.heightCm >= 120 && v.heightCm <= 230)) return toast("Height must be 120–230 cm");
    if (!(v.kg >= 30 && v.kg <= 300)) return toast(`Enter your weight in ${unit()}`);
    db.settings.profile = { sex: v.sex, born: v.born, heightCm: Math.round(v.heightCm), activity: v.activity, goal: v.goal };
    const day = Store.dayKey();
    db.weighIns = (db.weighIns || []).filter((w) => w.day !== day).concat({ day, kg: Math.round(v.kg * 10) / 10 }).sort((a, b) => a.day.localeCompare(b.day));
    if (applyGoals) {
      const r = calcBody(v);
      db.settings.goals = { kcal: r.kcal, p: r.p, c: r.c, f: r.f };
    }
    ui.modal = null; commit();
    toast(applyGoals ? "Saved. Daily food goals updated." : "Body stats saved");
  }

  const SUBMIT = {
    body: (fd) => saveBody(fd, false),
    exForm(fd) {
      const m = ui.modal;
      const kind = m.id ? (exById(m.id).kind || "strength") : (m.kind || "strength");
      let v;
      if (kind === "cardio") {
        v = { name: fd.get("name").trim(), durMin: num(fd.get("durMin")), durMax: num(fd.get("durMax")), intLabel: (fd.get("intLabel") || "").trim(), intStep: num(fd.get("intStep")) };
        if (!v.name) return toast("Name is required");
        if (!(v.durMin > 0 && v.durMax >= v.durMin)) return toast("Duration range must be like 20–40 min");
        if (!v.intLabel) return toast("Say what intensity is measured in (e.g. level)");
        if (!(v.intStep > 0)) return toast("Intensity step must be more than 0");
        v.durMin = Math.round(v.durMin); v.durMax = Math.round(v.durMax);
        if (fd.get("cardio")) v.cardio = fd.get("cardio"); // disabled (absent) for built-ins
        v.kind = "cardio";
      } else {
        v = { name: fd.get("name").trim(), repMin: num(fd.get("repMin")), repMax: num(fd.get("repMax")), sets: num(fd.get("sets")), inc: num(fd.get("inc")) };
        if (!v.name) return toast("Name is required");
        if (!(v.repMin > 0 && v.repMax >= v.repMin)) return toast("Rep range must be like 8–12");
        if (!(v.sets > 0)) return toast("Sets must be at least 1");
        if (!(v.inc > 0)) return toast("Weight step must be more than 0");
        const rest = num(fd.get("rest"));
        if (rest != null && !(rest >= 0 && rest <= 900)) return toast("Rest must be 0–900 seconds");
        v.rest = rest == null ? undefined : Math.round(rest);
        v.repMin = Math.round(v.repMin); v.repMax = Math.round(v.repMax); v.sets = Math.round(v.sets);
        if (fd.has("std")) v.std = fd.get("std") || undefined; // custom exercises only; built-ins have a fixed standard
      }
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
    addSet: (d) => { const en = db.active.entries[d.ei]; en.sets.push(blankSet(exById(en.exerciseId))); commit(); },
    removeSet: (d) => { db.active.entries[d.ei].sets.pop(); commit(); },
    toggleSet: (d) => {
      const en = db.active.entries[d.ei];
      const s = en.sets[d.si];
      if (s.done) { s.done = false; return commit(); }
      const ex = exById(en.exerciseId);
      if (isCardio(ex)) {
        const t = effTarget(en, +d.si, suggestionFor(en.exerciseId).sug);
        const min = s.min != null ? s.min : t.min, int = s.int != null ? s.int : t.int;
        if (!(min > 0)) {
          toast("Enter the minutes first");
          $(`input[data-bind="min"][data-ei="${d.ei}"][data-si="${d.si}"]`)?.focus();
          return;
        }
        Object.assign(s, { min, int, done: true }); // running distance is derived from speed × time when km is blank
        return commit(); // no rest timer after cardio
      }
      const t = effTarget(en, +d.si, suggestionFor(en.exerciseId).sug);
      const w = s.w != null ? s.w : t.w;
      const r = s.r != null ? s.r : t.r;
      if (w == null) {
        toast("Enter a weight first (0 for bodyweight)");
        $(`input[data-bind="w"][data-ei="${d.ei}"][data-si="${d.si}"]`)?.focus();
        return;
      }
      Object.assign(s, { w, r, done: true });
      unlockAudio();
      startRest(exById(en.exerciseId));
      commit();
    },
    swapEx: (d) => {
      const en = db.active.entries[d.ei], from = exById(en.exerciseId), to = exById(d.id);
      const n = en.sets.filter((s) => s.done).length;
      if (n && !confirm(`Swap ${from.name} for ${to.name}? The ${n} set${n === 1 ? "" : "s"} you logged on ${from.name} will be dropped.`)) return;
      db.active.entries[d.ei] = newEntry(d.id);
      commit(); toast(`Swapped to ${to.name}`);
    },
    restAdj: (d) => {
      const r = db.active?.rest;
      if (!r) return;
      r.endsAt = Math.max(Date.now(), r.endsAt + +d.d * 1000);
      r.total = Math.max(r.total, Math.ceil((r.endsAt - Date.now()) / 1000));
      if (r.endsAt > Date.now()) r.done = false;
      persist(); tickRest();
    },
    restSkip: () => { if (db.active) { delete db.active.rest; persist(); } tickRest(); },
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
    openBody: () => openModal({ type: "body" }),
    bodyApplyGoals: () => saveBody(new FormData($("#mform")), true),
    exKind: (d) => { const m = ui.modal; m.name = $("#mform")?.elements.name.value || m.name; m.kind = d.v; renderModal(); },
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
    relogEntry: (d) => {
      const e = db.foodLog.find((x) => x.id === d.id);
      copyFood([e], Store.dayKey());
      commit(); toast(`Logged ${e.name} again today`);
    },
    copyDayToToday: () => {
      const list = db.foodLog.filter((e) => e.day === ui.foodDay), today = Store.dayKey();
      if (!confirm(`Add ${list.length} entr${list.length === 1 ? "y" : "ies"} from ${dayLabel(ui.foodDay)} to today?`)) return;
      copyFood(list, today);
      ui.foodDay = today; commit(); toast(`Copied ${list.length} to today`);
    },
    copyPrevDay: () => {
      const from = Store.shiftDay(ui.foodDay, -1), list = db.foodLog.filter((e) => e.day === from);
      if (!confirm(`Add ${list.length} entr${list.length === 1 ? "y" : "ies"} from ${dayLabel(from)} to ${dayLabel(ui.foodDay)}?`)) return;
      copyFood(list, ui.foodDay);
      commit(); toast(`Copied ${list.length} entr${list.length === 1 ? "y" : "ies"}`);
    },
    // history
    histMode: (d) => { ui.histMode = d.v; ui.histEx = null; render(); },
    histEx: (d) => { ui.histEx = d.id; render(); window.scrollTo(0, 0); },
    histBack: () => { ui.histEx = null; render(); },
    goAwards: () => { ui.tab = "awards"; sessionStorage.setItem("tab", ui.tab); render(); window.scrollTo(0, 0); },
    histExFromAwards: (d) => { ui.tab = "history"; ui.histMode = "exercise"; ui.histEx = d.id; sessionStorage.setItem("tab", ui.tab); render(); window.scrollTo(0, 0); },
    editSession: (d) => {
      ui.sessionDraft = JSON.parse(JSON.stringify(db.sessions.find((s) => s.id === d.id)));
      openModal({ type: "sessionEdit" });
    },
    sRmSet: (d) => { ui.sessionDraft.entries[d.ei].sets.splice(+d.si, 1); renderModal(); },
    sAddSet: (d) => {
      const sets = ui.sessionDraft.entries[d.ei].sets, last = sets[sets.length - 1];
      sets.push(last ? { ...last } : { ...blankSet(exById(ui.sessionDraft.entries[d.ei].exerciseId)), done: true });
      renderModal();
    },
    sRmEntry: (d) => { ui.sessionDraft.entries.splice(+d.ei, 1); renderModal(); },
    saveSession: () => {
      const d = ui.sessionDraft;
      for (const e of d.entries) {
        if (isCardio(exById(e.exerciseId))) {
          for (const [i, s] of e.sets.entries()) {
            if (!(s.min > 0)) return toast(`${exById(e.exerciseId).name}, interval ${i + 1}: enter the minutes`);
            s.done = true;
          }
          continue;
        }
        for (const [i, s] of e.sets.entries()) {
          if (s.w == null || !(s.w >= 0) || !(s.r > 0)) return toast(`${exById(e.exerciseId)?.name || "Exercise"}, set ${i + 1}: enter weight (0 for bodyweight) and reps`);
          s.r = Math.round(s.r); s.done = true;
        }
      }
      d.entries = d.entries.filter((e) => e.sets.length);
      if (!d.entries.length) {
        if (!confirm("No sets left. Delete this workout?")) return;
        db.sessions = db.sessions.filter((s) => s.id !== d.id);
      } else {
        db.sessions = db.sessions.map((s) => (s.id === d.id ? d : s));
        db.sessions.sort((a, b) => a.date.localeCompare(b.date)); // the date may have changed; suggestions read the newest last
      }
      ui.modal = null; commit(); toast("Workout updated");
    },
    delSession: (d) => {
      if (!confirm("Delete this workout from history?")) return;
      db.sessions = db.sessions.filter((s) => s.id !== d.id); commit();
    },
    // settings
    setUnit: (d) => { db.settings.unit = d.v; commit(); },
    setRestOn: (d) => { db.settings.rest = { ...restCfg(), on: d.v === "1" }; commit(); },
    setWake: (d) => { db.settings.wakeLock = d.v === "1"; commit(); },
    setTheme: (d) => { db.settings.theme = d.v; commit(); toast(`${T().icon} ${T().name} theme on`); },
    goTheme: () => { ui.tab = "settings"; sessionStorage.setItem("tab", ui.tab); render(); $("#themeCard")?.scrollIntoView(); },
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
    } else if (t.hasAttribute("data-restsec")) {
      const sec = num(t.value);
      if (sec > 0 && sec <= 900) { db.settings.rest = { ...restCfg(), sec: Math.round(sec) }; persist(); }
    } else if (t.dataset.sbind) {
      const s = ui.sessionDraft.entries[t.dataset.ei]?.sets[t.dataset.si];
      if (s) s[t.dataset.sbind] = num(t.value);
    } else if (t.hasAttribute("data-sdate")) {
      if (!t.value) return;
      const [y, m, d] = t.value.split("-").map(Number), old = new Date(ui.sessionDraft.date);
      ui.sessionDraft.date = new Date(y, m - 1, d, old.getHours(), old.getMinutes()).toISOString();
    } else if (ui.modal?.type === "body" && t.form?.id === "mform") {
      $("#bodyOut").innerHTML = bodyResults(bodyVals(new FormData(t.form))); // live results as you type
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
    // New cardio exercise: picking a type fills in that type's sensible defaults.
    if (ev.target.name === "cardio" && ui.modal?.type === "exForm" && !ui.modal.id) {
      ui.modal.cardio = ev.target.value; ui.modal.name = $("#mform").elements.name.value; renderModal(); return;
    }
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
    syncWakeLock(); // the browser drops the screen lock whenever the app is hidden
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
