// Progression themes: names, icons and wording only. The mechanics (what counts, the thresholds) live in
// js/achievements.js and are identical for every theme, so switching theme never changes what you've earned.
//
// To add a theme: copy one object below (or one themed({...}) block), give it a new unique `id`, and fill in every key.
// Themed sets are one series/mythology each, never mixed.
// Only themes the owner has approved go in THEMES.
// Every theme needs: 6 tiers, all 9 families, all 3 feats and every text key.
// C (passed to desc functions) = { weekly, mastery } from Achievements.
(function () {
  const s = (n, one, many) => (n === 1 ? one : many);

  // Compact builder for themed sets (one anime series or one mythology each, never mixed). Fills in shared wording so each theme is just its own vocabulary.
  function themed(t) {
    const fam = {}, feats = {};
    for (const [k, [icon, name, desc]] of Object.entries(t.families)) fam[k] = { icon, name, desc };
    for (const [k, [icon, name, desc]] of Object.entries(t.feats)) feats[k] = { icon, name, desc };
    const x = t.text;
    return {
      id: t.id, name: t.name, tagline: t.tagline, icon: t.icon,
      tiers: t.tiers.map(([name, color]) => ({ name, color })),
      families: fam, feats,
      text: {
        tab: { icon: x.tab[0], label: x.tab[1] },
        title: x.title,
        streak: (n) => `${x.streakIcon} ${n}-week ${x.streak}`,
        streakShort: (n) => `${x.streakIcon} ${n} wk`,
        prs: x.prs, prsIcon: x.prsIcon,
        nextUp: x.nextUp, closest: "Almost unlocked", families: x.families, feats: "Legendary moments",
        levels: x.levels, levelWord: "Lv",
        levelsIntro: (p) => `+1 level for every ${p}% stronger a ${t.move} gets than on day one.`,
        locked: x.locked, done: x.done, maxed: x.maxed,
        celebrateTitle: x.celebrateTitle, celebrateUnlocked: x.celebrateUnlocked, celebrateLevelUp: x.celebrateLevelUp,
        celebratePRs: `${x.prsIcon} ${x.prs}`, celebrateButton: x.celebrateButton, empty: x.empty,
      },
    };
  }

  const THEMES = [
    {
      id: "iron-classic",
      name: "Iron Classic",
      tagline: "Clean gym progression: medals, records, streaks.",
      icon: "🏅",
      tiers: [
        { name: "Bronze", color: "#d08b4f" },
        { name: "Silver", color: "#c9d1db" },
        { name: "Gold", color: "#facc15" },
        { name: "Platinum", color: "#5eead4" },
        { name: "Diamond", color: "#7dd3fc" },
        { name: "Legend", color: "#c084fc" },
      ],
      families: {
        sessions: { icon: "🏋️", name: "Show Up", desc: (n) => `Finish ${n} ${s(n, "workout", "workouts")}` },
        streak: { icon: "🔥", name: "Locked In", desc: (n, C) => `${n} weeks in a row with ${C.weekly}+ workouts` },
        prs: { icon: "🏆", name: "Record Breaker", desc: (n) => `Set ${n} personal ${s(n, "record", "records")}` },
        clears: { icon: "🎯", name: "Top of the Range", desc: (n) => `Hit max reps on every set ${s(n, "once", n + " times")}` },
        heavier: { icon: "⬆️", name: "Heavier Now", desc: (n) => `Lift a new top weight ${s(n, "once", n + " times")}` },
        gain: { icon: "📈", name: "Stronger Than Day One", desc: (n) => `Any exercise +${n}% stronger than your first session` },
        sets: { icon: "🧱", name: "Brick by Brick", desc: (n) => `Log ${n} sets` },
        variety: { icon: "🧭", name: "Explorer", desc: (n) => `Train ${n} different exercises` },
        mastery: { icon: "⭐", name: "Specialist", desc: (n, C) => `Get ${n} ${s(n, "exercise", "exercises")} to level ${C.mastery}` },
      },
      feats: {
        "clean-sweep": { icon: "🧹", name: "Clean Sweep", desc: "PRs on 3+ exercises in one workout" },
        comeback: { icon: "🔁", name: "Comeback", desc: "Train again after a 14+ day break" },
        loyal: { icon: "🤝", name: "Bread & Butter", desc: "Train one exercise in 20 different workouts" },
      },
      text: {
        tab: { icon: "🏅", label: "Awards" },
        title: "Awards",
        streak: (n) => `🔥 ${n}-week streak`,
        streakShort: (n) => `🔥 ${n} wk`,
        prs: "PRs", prsIcon: "🏆",
        nextUp: "Next up",
        closest: "Closest to unlocking",
        families: "Achievements",
        feats: "Feats",
        levels: "Exercise levels",
        levelWord: "Lv",
        levelsIntro: (p) => `+1 level for every ${p}% you get stronger than your first session.`,
        locked: "Locked", done: "Done", maxed: "All tiers earned",
        celebrateTitle: "Workout complete 💪",
        celebrateUnlocked: "Unlocked",
        celebrateLevelUp: "Level up",
        celebratePRs: "🏆 Personal records",
        celebrateButton: "Nice",
        empty: "Finish your first workout to start unlocking awards.",
      },
    },

    // ---------- mythology themes ----------
    themed({
      id: "greek", name: "Greek Myth", icon: "🏛️", tagline: "From Mortal to Olympian.",
      tiers: [["Mortal", "#a8a29e"], ["Spartan", "#ef4444"], ["Hero", "#f59e0b"], ["Demigod", "#a78bfa"], ["Titan", "#38bdf8"], ["Olympian", "#facc15"]],
      move: "exercise", moves: "exercises",
      families: {
        sessions: ["🏛️", "The Labours", (n) => `Complete ${n} ${s(n, "labour", "labours")}`],
        streak: ["🔥", "Eternal Flame", (n, C) => `Keep the flame lit: ${n} weeks in a row with ${C.weekly}+ labours`],
        prs: ["⚡", "Thunderbolt", (n) => `Strike a new record ${s(n, "once", n + " times")} (PRs)`],
        clears: ["🌿", "Olympic Laurel", (n) => `Win the laurel: max reps on every set ${s(n, "once", n + " times")}`],
        heavier: ["🌍", "Atlas Carry", (n) => `Shoulder a heavier world: new top weight ${s(n, "once", n + " times")}`],
        gain: ["🍯", "Ambrosia", (n) => `Any exercise +${n}% stronger than your mortal self`],
        sets: ["🪨", "Sisyphus", (n) => `Push the boulder ${n} times (sets)`],
        variety: ["🏺", "Pantheon", (n) => `Add ${n} different exercises to your pantheon`],
        mastery: ["🦁", "Nemean Lion", (n, C) => `Slay the lion: master ${n} ${s(n, "exercise", "exercises")} to level ${C.mastery}`],
      },
      feats: {
        "clean-sweep": ["🐉", "Hydra Slayer", "PRs on 3+ exercises in one labour"],
        comeback: ["🌊", "Odyssey", "Find your way home after a 14+ day break"],
        loyal: ["🛡️", "Spartan Discipline", "Train one exercise in 20 different labours"],
      },
      text: { tab: ["🏛️", "Olympus"], title: "Hall of Olympus", streak: "eternal flame", streakIcon: "🔥", prs: "Thunderbolts", prsIcon: "⚡",
        nextUp: "Next labour", families: "Labours & trials", levels: "Exercise levels", locked: "Mortal", done: "Won", maxed: "Olympian",
        celebrateTitle: "Labour complete! 🏛️", celebrateUnlocked: "Glory earned", celebrateLevelUp: "Favour of the gods", celebrateButton: "For glory!",
        empty: "Even Heracles started as a mortal. Finish a workout to begin." },
    }),


    // ---------- history & sport themes ----------
    themed({
      id: "roman", name: "Roman Legion", icon: "🦅", tagline: "From Recruit to Caesar.",
      tiers: [["Recruit", "#a8a29e"], ["Legionary", "#dc2626"], ["Centurion", "#d08b4f"], ["Tribune", "#f8fafc"], ["Legate", "#a78bfa"], ["Caesar", "#facc15"]],
      move: "exercise", moves: "exercises",
      families: {
        sessions: ["🦅", "March to Rome", (n) => `Complete ${n} ${s(n, "march", "marches")}`],
        streak: ["⛓️", "Iron Discipline", (n, C) => `${n} weeks in a row with ${C.weekly}+ marches`],
        prs: ["💰", "Spoils of War", (n) => `Claim the spoils ${s(n, "once", n + " times")} (PRs)`],
        clears: ["🐢", "Testudo", (n) => `Hold the formation: max reps on every set ${s(n, "once", n + " times")}`],
        heavier: ["🛡️", "Heavier Shield", (n) => `Carry a heavier shield: new top weight ${s(n, "once", n + " times")}`],
        gain: ["🏛️", "Rise of the Empire", (n) => `Any exercise +${n}% stronger than day one`],
        sets: ["🛤️", "Roads Built", (n) => `Lay ${n} stones (sets): all roads lead to Rome`],
        variety: ["🗺️", "Provinces Conquered", (n) => `Conquer ${n} different exercises`],
        mastery: ["🎖️", "Veteran Cohort", (n, C) => `Make ${n} ${s(n, "exercise a veteran", "exercises veterans")}: level ${C.mastery}`],
      },
      feats: {
        "clean-sweep": ["🏆", "Triumph", "PRs on 3+ exercises in one march"],
        comeback: ["🌊", "Crossing the Rubicon", "Return after a 14+ day break"],
        loyal: ["🦅", "The Eagle Standard", "Train one exercise in 20 different marches"],
      },
      text: { tab: ["🦅", "Legion"], title: "Annals of Rome", streak: "campaign", streakIcon: "⚔️", prs: "Spoils of war", prsIcon: "💰",
        nextUp: "Next campaign", families: "Ranks & campaigns", levels: "Exercise levels", locked: "Unconquered", done: "Conquered", maxed: "Caesar",
        celebrateTitle: "March complete! 🦅", celebrateUnlocked: "Promoted", celebrateLevelUp: "Honours", celebrateButton: "Ave!",
        empty: "Rome wasn't built in a day. Finish a workout to begin your march." },
    }),

    themed({
      id: "olympic", name: "Olympic Path", icon: "🥇", tagline: "From Club to Olympic Champion.",
      tiers: [["Club", "#a8a29e"], ["Regional", "#60a5fa"], ["National", "#4ade80"], ["Continental", "#f97316"], ["World Class", "#c9d1db"], ["Olympic Champion", "#facc15"]],
      move: "exercise", moves: "exercises",
      families: {
        sessions: ["📓", "Training Log", (n) => `Log ${n} training ${s(n, "session", "sessions")}`],
        streak: ["🏕️", "Training Camp", (n, C) => `${n} weeks in a row with ${C.weekly}+ sessions`],
        prs: ["⏱️", "Personal Bests", (n) => `Set ${n} personal ${s(n, "best", "bests")}`],
        clears: ["✅", "Qualifying Standard", (n) => `Hit the standard: max reps on every set ${s(n, "once", n + " times")}`],
        heavier: ["🏋️", "Raise the Bar", (n) => `New top weight ${s(n, "once", n + " times")}`],
        gain: ["📈", "Peak Form", (n) => `Any exercise +${n}% stronger than day one`],
        sets: ["📦", "Volume Block", (n) => `Log ${n} sets`],
        variety: ["🏅", "Decathlon", (n) => `Train ${n} different exercises`],
        mastery: ["🎯", "Medal Events", (n, C) => `Get ${n} ${s(n, "exercise", "exercises")} to level ${C.mastery}`],
      },
      feats: {
        "clean-sweep": ["🏆", "Podium Sweep", "Personal bests on 3+ exercises in one session"],
        comeback: ["🔁", "Comeback Season", "Return after a 14+ day break"],
        loyal: ["⭐", "Signature Event", "Train one exercise in 20 different sessions"],
      },
      text: { tab: ["🥇", "Medals"], title: "Medal Table", streak: "training camp", streakIcon: "🔥", prs: "Personal bests", prsIcon: "⏱️",
        nextUp: "Next qualifier", families: "Events", levels: "Exercise levels", locked: "Not qualified", done: "Qualified", maxed: "Olympic Champion",
        celebrateTitle: "Session complete! 🥇", celebrateUnlocked: "Qualified", celebrateLevelUp: "Ranking up", celebrateButton: "Gold!",
        empty: "Every champion starts at the club. Finish a workout to begin." },
    }),
  ];

  const DEFAULT = "iron-classic";
  const get = (id) => THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT);

  window.Themes = { list: THEMES, get, DEFAULT };
})();
