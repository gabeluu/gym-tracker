// Real-world ranks per exercise, from history + body profile. Pure (reads db, writes nothing).
//
// Rules (by design, so a rank never goes down):
// - Each exercise's rank is its BEST result ever, judged at the bodyweight you had on that workout day
//   (the latest weigh-in on or before it). Gaining weight later never lowers an old result.
// - Nothing is required: exercises you skip, or never do, cost nothing.
// - Overall strength = average percentile of your 3 best-ranked lifts, so adding a weak new lift can't drag it down.
(function () {
  const P = Progression, S = Standards;
  const LB = 2.20462;

  function bodyweightAt(db, iso) {
    const w = db.weighIns || [];
    if (!w.length) return null;
    const day = Store.dayKey(iso);
    let kg = w[0].kg;
    for (const x of w) if (x.day <= day) kg = x.kg;
    return kg;
  }
  const currentBodyweight = (db) => (db.weighIns && db.weighIns.length ? db.weighIns[db.weighIns.length - 1].kg : null);

  // Strength value in the standard's units: kg 1RM (Epley, sets of ≤15 reps), kg of one dumbbell, or best reps.
  function strengthValue(def, std, sets, toKg) {
    if (std.unit === "reps") return Math.max(0, ...sets.map((s) => s.r));
    const ok = sets.filter((s) => s.w > 0 && s.r <= 15);
    return ok.length ? Math.max(...ok.map((s) => P.e1rm(s.w, s.r))) * toKg : 0;
  }

  function compute(db) {
    const prof = (db.settings && db.settings.profile) || {};
    const sex = prof.sex, age = prof.born ? new Date().getFullYear() - prof.born : null;
    const out = { ex: new Map(), overall: null, cardioBest: null, missing: [] };
    if (!sex) out.missing.push("sex");
    if (!(db.weighIns && db.weighIns.length)) out.missing.push("bodyweight");
    if (!(age > 0)) out.missing.push("age");
    if (!sex || !(db.weighIns && db.weighIns.length)) return out;

    const toKg = db.settings.unit === "lb" ? 1 / LB : 1;
    const defs = new Map(db.exercises.map((e) => [e.id, e]));
    for (const s of db.sessions) {
      const bw = bodyweightAt(db, s.date);
      for (const e of s.entries) {
        const def = defs.get(e.exerciseId);
        if (!def) continue;
        let r = null;
        if (def.kind === "cardio") {
          const bouts = P.doneCardio(e);
          if (def.cardio === "run" && age > 0) {
            const t = Math.min(...bouts.map((b) => S.fiveKEquivalent(P.cardioKm(def, b), b.min) || Infinity));
            const res = isFinite(t) ? S.run(sex, age, t) : null;
            if (res) r = { type: "run", ...res, value: t, score: res.z };
          } else if (def.cardio === "bike") {
            // FTP estimate: average watts of a ≥20 min bout × 0.95 (≥60 min: × 1). Easy rides underestimate, never overestimate.
            const ftp = Math.max(0, ...bouts.filter((b) => b.watts > 0 && b.min >= 20).map((b) => b.watts * (b.min >= 60 ? 1 : 0.95)));
            const res = ftp > 0 ? S.bike(sex, ftp / bw) : null;
            if (res) r = { type: "bike", ...res, value: res.wkg, score: res.wkg };
          }
        } else if (def.std && S.STRENGTH[def.std]) {
          const std = S.STRENGTH[def.std];
          const v = strengthValue(def, std, P.doneSets(e), toKg);
          const res = v > 0 ? S.strength(def.std, sex, bw, v) : null;
          if (res) r = { type: "strength", unit: std.unit, ...res, value: v, bw, score: res.z };
        }
        if (!r) continue;
        const cur = out.ex.get(def.id);
        if (!cur || r.score > cur.score) out.ex.set(def.id, { ...r, date: s.date, exerciseId: def.id });
      }
    }

    // What the next tier needs, at today's bodyweight/age.
    const bwNow = currentBodyweight(db);
    for (const [id, r] of out.ex) {
      const def = defs.get(id);
      const nextTier = r.tier + 1;
      if (r.type === "strength") {
        const v = nextTier <= 6 ? S.strengthTarget(def.std, sex, bwNow, nextTier) : null;
        r.next = v ? { tier: nextTier, value: r.unit === "reps" ? Math.ceil(v) : v / toKg } : null;
      } else if (r.type === "run") {
        const t = nextTier <= 6 ? S.runTarget(sex, age, nextTier) : null;
        r.next = t ? { tier: nextTier, t5k: t } : null;
      } else if (r.type === "bike") {
        const wkg = S.bikeTarget(sex, nextTier);
        r.next = wkg ? { tier: nextTier, watts: wkg * bwNow / 0.95, wkg } : null;
      }
    }

    const lifts = [...out.ex.values()].filter((r) => r.type === "strength").sort((a, b) => b.p - a.p).slice(0, 3);
    if (lifts.length) {
      const p = lifts.reduce((n, r) => n + r.p, 0) / lifts.length;
      const tier = 1 + S.TIER_P.slice(1).filter((t) => p >= t).length;
      out.overall = { p, tier, count: lifts.length };
    }
    const cardio = [...out.ex.values()].filter((r) => r.type !== "strength").sort((a, b) => b.tier - a.tier || (b.p || 0) - (a.p || 0));
    out.cardioBest = cardio[0] || null;
    return out;
  }

  // Tier increases between two compute() results (for the finish-workout sheet).
  function diff(before, after) {
    const ups = [];
    for (const [id, r] of after.ex) {
      const old = before.ex.get(id);
      if (!old || r.tier > old.tier) ups.push({ id, from: old ? old.tier : 0, to: r.tier, r });
    }
    return ups;
  }

  window.Ranks = { compute, diff, bodyweightAt, currentBodyweight, LB };
})();
