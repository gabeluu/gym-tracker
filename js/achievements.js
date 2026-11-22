// Achievements + per-exercise levels. Pure functions, no DOM, no storage.
//
// Design rule: everything is computed from finished sessions using only fields that EVERY exercise has
// (weight, reps, and the exercise's own repMax/sets). Nothing depends on muscles, names, the built-in
// library, absolute kilos or the kg/lb label. So an exercise you typed in yourself counts exactly like a
// built-in one, and a 20 kg curl progresses as fast as a 140 kg leg press: progress is always measured
// against YOUR OWN first session on that exercise.
//
// Nothing is stored. Achievements are recomputed from history, so they work retroactively, survive
// export/import, and stay honest if you delete a session.
(function () {
  const P = Progression;
  const EPS = 0.01;
  const LEVEL_STEP = 0.05;     // +5% stronger than your first session = +1 exercise level
  const MASTERY_LEVEL = 5;     // level 5 = +20% over day one
  const WEEKLY_TARGET = 2;     // a streak week = at least this many training days
  const COMEBACK_DAYS = 14;

  // Mechanics only. Names, icons and wording come from the active theme (js/themes.js).
  const TIER_COUNT = 6;
  // Tiered families. `stat` is a key of the global stats object computed below.
  const FAMILIES = [
    { id: "sessions", stat: "sessions", tiers: [1, 10, 25, 50, 100, 250] },
    { id: "streak", stat: "bestStreak", tiers: [2, 4, 8, 12, 26, 52] },
    { id: "prs", stat: "prs", tiers: [1, 10, 25, 50, 100, 250] },
    { id: "clears", stat: "clears", tiers: [1, 5, 15, 30, 60, 120] },
    { id: "heavier", stat: "weightUps", tiers: [1, 10, 25, 50, 100, 200] },
    { id: "gain", stat: "bestGainPct", tiers: [10, 25, 50, 75, 100, 150] },
    { id: "sets", stat: "sets", tiers: [50, 250, 500, 1000, 2500, 5000] },
    { id: "variety", stat: "exercises", tiers: [3, 6, 10, 15, 25] },
    { id: "mastery", stat: "mastered", tiers: [1, 3, 5, 8, 12] },
  ];
  // One-off feats: clean-sweep (3+ PRs in one workout), comeback (COMEBACK_DAYS+ break), loyal (20 sessions of one exercise).
  const FEATS = ["clean-sweep", "comeback", "loyal"];

  // Local calendar day number (DST-safe) and Monday-based week number.
  function dayNum(iso) {
    const d = new Date(iso);
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }
  const weekNum = (day) => Math.floor((day + 3) / 7); // 1970-01-01 was a Thursday

  // Strength score of one set. Weighted: Epley e1RM. Bodyweight (w = 0): Epley with your bodyweight as 1,
  // i.e. 1 + r/30, so "+10% stronger" means the same effort jump whether you add kilos or reps.
  const score = (w, r) => (w > 0 ? P.e1rm(w, r) : 1 + r / 30);

  // Level from best/first score. Weighted and bodyweight are tracked as separate series (never mixed).
  function levelFor(gain) { return 1 + Math.max(0, Math.floor(gain / LEVEL_STEP + 1e-9)); }

  function newExStat(id) {
    return { id, sessions: 0, prs: 0, clears: 0, weightUps: 0,
      w: { first: 0, best: 0, maxW: 0 },   // weighted series
      bw: { first: 0, best: 0, maxR: 0 },  // bodyweight series
      gain: 0, level: 1, series: null };
  }

  function finishExStat(st) {
    const gw = st.w.first ? st.w.best / st.w.first - 1 : 0;
    const gb = st.bw.first ? st.bw.best / st.bw.first - 1 : 0;
    st.series = st.w.first && (gw >= gb || !st.bw.first) ? "w" : st.bw.first ? "bw" : null;
    st.gain = Math.max(gw, gb, 0);
    st.level = levelFor(st.gain);
    // What the next level needs, in the units of the active series.
    const s = st.series === "w" ? st.w : st.bw;
    const need = s.first * (1 + LEVEL_STEP * st.level);
    st.next = st.cardio ? { cardio: true } : st.series === "w" ? { e1rm: need } : st.series === "bw" ? { reps: Math.ceil(30 * (need - 1) - 1e-9) } : null;
    st.levelProgress = Math.min(1, Math.max(0, (st.gain - LEVEL_STEP * (st.level - 1)) / LEVEL_STEP));
    return st;
  }

  /**
   * Full computation. Returns { stats, ex: Map(exerciseId → per-exercise stat), families, feats, earnedIds }.
   * exercises: db.exercises (only repMax/sets are read, for "Top of the Range").
   */
  function compute(db) {
    const exDefs = new Map((db.exercises || []).map((e) => [e.id, e]));
    const sessions = (db.sessions || []).filter((s) => s && Array.isArray(s.entries))
      .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const ex = new Map();
    const stats = { sessions: 0, sets: 0, prs: 0, clears: 0, weightUps: 0, bestGainPct: 0, exercises: 0,
      mastered: 0, bestStreak: 0, currentStreak: 0, thisWeek: 0 };
    const feats = new Set();
    const days = [];

    for (const s of sessions) {
      let counted = false, sessionPRs = 0;
      for (const e of s.entries) {
        const def0 = exDefs.get(e.exerciseId);
        if (def0 && def0.kind === "cardio") {
          // Cardio: score = P.cardioScore (5K-equivalent speed for runs, minutes × intensity otherwise).
          const bouts = P.doneCardio(e);
          if (!bouts.length) continue;
          counted = true;
          stats.sets += bouts.length;
          let st = ex.get(e.exerciseId);
          if (!st) ex.set(e.exerciseId, (st = newExStat(e.exerciseId)));
          st.cardio = true;
          const best = Math.max(...bouts.map((b) => P.cardioScore(def0, b)));
          const topInt = Math.max(0, ...bouts.map((b) => b.int || 0));
          let pr = false;
          if (best > 0) {
            if (!st.w.first) st.w.first = best;
            else if (best > st.w.best + EPS) pr = true;
            st.w.best = Math.max(st.w.best, best);
          }
          if (st.sessions && topInt > st.w.maxW + EPS) { st.weightUps++; stats.weightUps++; } // harder setting = "heavier"
          st.w.maxW = Math.max(st.w.maxW, topInt);
          if (pr) { st.prs++; stats.prs++; sessionPRs++; }
          if (def0.durMax && bouts.some((b) => b.min >= def0.durMax)) { st.clears++; stats.clears++; } // top of the duration range
          st.sessions++;
          if (st.sessions >= 20) feats.add("loyal");
          continue;
        }
        const done = P.doneSets(e);
        if (!done.length) continue;
        counted = true;
        stats.sets += done.length;
        let st = ex.get(e.exerciseId);
        if (!st) ex.set(e.exerciseId, (st = newExStat(e.exerciseId)));

        const weighted = done.filter((x) => x.w > 0);
        const bodyweight = done.filter((x) => !(x.w > 0));
        let pr = false;

        if (weighted.length) {
          const topW = Math.max(...weighted.map((x) => x.w));
          const best = Math.max(...weighted.map((x) => score(x.w, x.r)));
          if (!st.w.first) st.w.first = best;
          else {
            if (topW > st.w.maxW + EPS) { st.weightUps++; stats.weightUps++; pr = true; }
            if (best > st.w.best + EPS) pr = true;
          }
          st.w.best = Math.max(st.w.best, best);
          st.w.maxW = Math.max(st.w.maxW, topW);
        }
        if (bodyweight.length) {
          const bestR = Math.max(...bodyweight.map((x) => x.r));
          if (!st.bw.first) st.bw.first = score(0, bestR);
          else if (bestR > st.bw.maxR) pr = true;
          st.bw.best = Math.max(st.bw.best, score(0, bestR));
          st.bw.maxR = Math.max(st.bw.maxR, bestR);
        }
        if (pr) { st.prs++; stats.prs++; sessionPRs++; }

        // "Top of the Range": every target set at the top weight reached repMax (the app's "▲ Go up" moment).
        const def = exDefs.get(e.exerciseId);
        if (def) {
          const topW = Math.max(...done.map((x) => x.w));
          const atTop = done.filter((x) => x.w === topW);
          const n = Math.max(1, def.sets || 3);
          if (atTop.length >= n && atTop.slice(0, n).every((x) => x.r >= def.repMax)) { st.clears++; stats.clears++; }
        }
        st.sessions++;
        if (st.sessions >= 20) feats.add("loyal");
      }
      if (!counted) continue;
      stats.sessions++;
      if (sessionPRs >= 3) feats.add("clean-sweep");
      const d = dayNum(s.date);
      if (days.length && d - days[days.length - 1] >= COMEBACK_DAYS) feats.add("comeback");
      if (!days.length || days[days.length - 1] !== d) days.push(d);
    }

    for (const st of ex.values()) {
      finishExStat(st);
      stats.bestGainPct = Math.max(stats.bestGainPct, Math.floor(st.gain * 100 + 1e-9));
      if (st.level >= MASTERY_LEVEL) stats.mastered++;
    }
    stats.exercises = ex.size;

    // Weekly streaks: consecutive weeks with WEEKLY_TARGET+ distinct training days.
    const perWeek = new Map();
    for (const d of days) perWeek.set(weekNum(d), (perWeek.get(weekNum(d)) || 0) + 1);
    const good = [...perWeek].filter(([, n]) => n >= WEEKLY_TARGET).map(([w]) => w).sort((a, b) => a - b);
    let run = 0;
    good.forEach((w, i) => { run = i && good[i - 1] === w - 1 ? run + 1 : 1; stats.bestStreak = Math.max(stats.bestStreak, run); });
    const nowWeek = weekNum(dayNum(new Date().toISOString()));
    stats.thisWeek = perWeek.get(nowWeek) || 0;
    const goodSet = new Set(good);
    let w = goodSet.has(nowWeek) ? nowWeek : nowWeek - 1; // this week isn't over yet, so it can't break a streak
    while (goodSet.has(w)) { stats.currentStreak++; w--; }

    const families = FAMILIES.map((f) => {
      const value = stats[f.stat];
      const tier = f.tiers.filter((t) => value >= t).length; // 0 = none earned yet
      const next = f.tiers[tier];
      const prev = tier ? f.tiers[tier - 1] : 0;
      return { ...f, value, tier, next, progress: next == null ? 1 : Math.min(1, value / next),
        // progress inside the current tier band, for "closest to unlocking"
        bandProgress: next == null ? 1 : Math.max(0, (value - prev) / (next - prev)) };
    });

    const earnedIds = new Set();
    families.forEach((f) => { for (let i = 0; i < f.tier; i++) earnedIds.add(`${f.id}:${i}`); });
    feats.forEach((id) => earnedIds.add(`feat:${id}`));

    return { stats, ex, families, feats: FEATS.map((id) => ({ id, earned: feats.has(id) })), earnedIds };
  }

  // Parse an earned id: "sessions:2" → { kind: "family", id: "sessions", tier: 2 } (0-based tier).
  function describe(key) {
    const [fid, t] = key.split(":");
    if (fid === "feat") return FEATS.includes(t) ? { kind: "feat", id: t } : null;
    return FAMILIES.some((f) => f.id === fid) ? { kind: "family", id: fid, tier: +t } : null;
  }

  // What changed between two compute() results (before/after finishing a workout).
  function diff(before, after) {
    const unlocked = [...after.earnedIds].filter((id) => !before.earnedIds.has(id)).map(describe).filter(Boolean);
    const levelUps = [];
    for (const [id, st] of after.ex) {
      const old = before.ex.get(id);
      if (old && st.level > old.level) levelUps.push({ id, from: old.level, to: st.level });
    }
    return { unlocked, levelUps };
  }

  window.Achievements = { compute, diff, describe, FAMILIES, FEATS, TIER_COUNT, MASTERY_LEVEL, WEEKLY_TARGET, LEVEL_STEP,
    C: { weekly: WEEKLY_TARGET, mastery: MASTERY_LEVEL } };
})();
