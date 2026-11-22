// Pure progression math. No DOM, no storage.
(function () {
  const round = (x) => Math.round(x * 100) / 100;

  // Epley estimated 1RM.
  function e1rm(w, r) {
    if (!w || !r) return 0;
    return r === 1 ? w : w * (1 + r / 30);
  }

  // Completed sets with a positive weight and reps.
  function doneSets(entry) {
    return (entry && entry.sets ? entry.sets : []).filter((s) => s.done && s.r > 0 && s.w >= 0);
  }

  // Most recent finished session entry for an exercise (sessions sorted oldest→newest).
  function lastEntry(sessions, exerciseId, excludeSessionId) {
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i];
      if (s.id === excludeSessionId) continue;
      const e = s.entries.find((x) => x.exerciseId === exerciseId);
      if (e && doneSets(e).length) return { session: s, entry: e };
    }
    return null;
  }

  /**
   * Double progression.
   * ex: { repMin, repMax, sets, inc }
   * last: array of completed sets [{w, r}] from the previous session, or empty.
   * Returns { targets: [{w, r}], status: "new"|"increase"|"build"|"struggling", note }
   */
  function suggest(ex, last) {
    const n = Math.max(1, ex.sets || 3);
    if (!last || !last.length) {
      return {
        status: "new",
        note: `First time: pick a weight you can do for ${ex.repMin}–${ex.repMax} reps.`,
        targets: Array.from({ length: n }, () => ({ w: null, r: ex.repMin })),
      };
    }

    const topW = Math.max(...last.map((s) => s.w));
    const working = last.filter((s) => s.w === topW);

    const hitTop = working.length >= n && working.slice(0, n).every((s) => s.r >= ex.repMax);
    if (hitTop) {
      const w = round(topW + ex.inc);
      return {
        status: "increase",
        note: `Hit ${ex.repMax} on all ${n} sets last time → +${ex.inc}`,
        targets: Array.from({ length: n }, () => ({ w, r: ex.repMin })),
      };
    }

    const targets = Array.from({ length: n }, (_, i) => {
      const prev = working[i];
      const r = prev ? Math.min(prev.r + 1, ex.repMax) : ex.repMin;
      return { w: topW, r: Math.max(r, ex.repMin) };
    });
    const best = Math.max(...working.map((s) => s.r));
    if (best < ex.repMin) {
      return {
        status: "struggling",
        note: `Below ${ex.repMin} reps last time. Repeat, or drop the weight if it stalls again.`,
        targets,
      };
    }
    return { status: "build", note: `Same weight, beat last time's reps (+1 per set).`, targets };
  }

  // PRs across all finished sessions for an exercise.
  function records(sessions, exerciseId) {
    let maxW = 0, maxE = 0, history = [];
    for (const s of sessions) {
      const e = s.entries.find((x) => x.exerciseId === exerciseId);
      const sets = doneSets(e);
      if (!sets.length) continue;
      let bestE = 0, topW = 0;
      for (const st of sets) {
        bestE = Math.max(bestE, e1rm(st.w, st.r));
        topW = Math.max(topW, st.w);
      }
      maxW = Math.max(maxW, topW);
      maxE = Math.max(maxE, bestE);
      history.push({ date: s.date, sets, e1rm: round(bestE), topW });
    }
    return { maxW, maxE: round(maxE), history };
  }

  window.Progression = { e1rm, suggest, lastEntry, records, doneSets };
})();
