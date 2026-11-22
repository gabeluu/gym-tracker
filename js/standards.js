// Real-world performance data + percentile math. Pure: no DOM, no storage.
//
// Lifts: Strength Level (strengthlevel.com) standards, ~46M qualifying community-logged lifts (2015–2026).
//   Its five levels ARE percentiles of lifters: Beginner 5th, Novice 20th, Intermediate 50th, Advanced 80th, Elite 95th.
//   We store a few bodyweight rows per lift and sex, and interpolate between them on a log scale.
//   Values are one-rep max in kg ("kg"), weight of ONE dumbbell ("db"), or bodyweight reps ("reps").
// Running: Running Level (runninglevel.com) 5K times by age and sex, ~68k qualifying results, same five percentiles.
// Bike: no trustworthy percentile data exists, so FTP in W/kg is graded with Allen & Coggan's categories
//   (Training and Racing with a Power Meter, 2010, as used in Garmin's "FTP ratings").
//
// Between the published points we interpolate in "z-space" (normal-distribution units), which is how percentiles
// behave. Above the 95th percentile (top 5%) we extrapolate, so the 99th-percentile tier is an estimate.
(function () {
  const Z = [-1.6449, -0.8416, 0, 0.8416, 1.6449]; // 5th, 20th, 50th, 80th, 95th percentile
  // Theme tier k (1..6) starts at this percentile: anyone / top 80% / top 50% / top 20% / top 5% / top 1%.
  const TIER_P = [0, 20, 50, 80, 95, 99];
  const TIER_Z = [-Infinity, -0.8416, 0, 0.8416, 1.6449, 2.3263];

  // [Beginner, Novice, Intermediate, Advanced, Elite] by bodyweight (kg). m = male, f = female.
  const STRENGTH = {
    "bench-press": { name: "Bench Press (barbell)", unit: "kg",
      m: { 60: [37, 53, 72, 95, 119], 80: [56, 75, 98, 124, 151], 100: [73, 95, 120, 149, 179], 120: [89, 113, 140, 171, 203] },
      f: { 50: [14, 25, 40, 58, 79], 70: [22, 36, 53, 74, 96], 90: [30, 45, 64, 86, 111] } },
    "squat": { name: "Squat (barbell)", unit: "kg",
      m: { 60: [49, 71, 98, 129, 162], 80: [75, 101, 132, 168, 206], 100: [98, 128, 163, 203, 244], 120: [120, 152, 191, 233, 278] },
      f: { 50: [26, 42, 63, 88, 116], 70: [37, 56, 80, 109, 140], 90: [47, 68, 94, 125, 158] } },
    "deadlift": { name: "Deadlift (barbell)", unit: "kg",
      m: { 60: [61, 86, 117, 153, 191], 80: [89, 119, 155, 196, 239], 100: [114, 148, 188, 232, 279], 120: [137, 174, 217, 265, 315] },
      f: { 50: [34, 52, 76, 105, 136], 70: [46, 68, 95, 126, 160], 90: [57, 80, 109, 143, 180] } },
    "shoulder-press": { name: "Overhead Press (barbell)", unit: "kg",
      m: { 60: [21, 32, 45, 62, 79], 80: [33, 46, 62, 81, 101], 100: [44, 59, 77, 98, 120], 120: [54, 71, 90, 113, 136] },
      f: { 50: [10, 17, 27, 38, 51], 70: [15, 23, 34, 47, 62], 90: [19, 28, 40, 54, 70] } },
    "chest-press": { name: "Machine Chest Press", unit: "kg",
      m: { 60: [27, 45, 70, 100, 134], 80: [39, 61, 89, 123, 160], 100: [50, 74, 105, 142, 181], 120: [60, 87, 120, 158, 200] },
      f: { 50: [9, 19, 33, 50, 71], 70: [12, 23, 38, 57, 79], 90: [15, 27, 43, 63, 85] } },
    "lat-pulldown": { name: "Lat Pulldown", unit: "kg",
      m: { 60: [35, 50, 69, 90, 113], 80: [47, 64, 85, 108, 133], 100: [57, 76, 98, 123, 150], 120: [66, 86, 110, 136, 164] },
      f: { 50: [20, 30, 42, 56, 72], 70: [25, 36, 49, 64, 81], 90: [29, 41, 55, 71, 88] } },
    "machine-row": { name: "Machine Row", unit: "kg",
      m: { 60: [31, 52, 80, 113, 151], 80: [47, 72, 104, 142, 184], 100: [62, 90, 125, 167, 211], 120: [75, 106, 144, 188, 236] },
      f: { 50: [18, 31, 47, 67, 90], 70: [23, 37, 55, 77, 101], 90: [27, 42, 61, 84, 109] } },
    "seated-leg-curl": { name: "Seated Leg Curl", unit: "kg",
      m: { 60: [29, 45, 67, 94, 123], 80: [39, 58, 83, 112, 144], 100: [48, 69, 96, 127, 161], 120: [56, 79, 107, 140, 175] },
      f: { 50: [17, 28, 43, 62, 83], 70: [21, 34, 51, 70, 93], 90: [25, 39, 56, 77, 100] } },
    "hack-squat": { name: "Hack Squat", unit: "kg",
      m: { 60: [41, 73, 117, 171, 231], 80: [63, 102, 152, 213, 280], 100: [84, 127, 183, 249, 321], 120: [102, 150, 210, 281, 357] },
      f: { 50: [19, 43, 78, 124, 176], 70: [28, 56, 95, 145, 202], 90: [36, 67, 109, 162, 221] } },
    "sled-leg-press": { name: "Leg Press", unit: "kg",
      m: { 60: [71, 115, 173, 242, 319], 80: [109, 162, 230, 309, 395], 100: [144, 205, 280, 366, 460], 120: [176, 243, 324, 417, 516] },
      f: { 50: [39, 73, 122, 183, 252], 70: [58, 100, 155, 223, 299], 90: [76, 122, 183, 256, 337] } },
    "machine-calf-raise": { name: "Machine Calf Raise", unit: "kg",
      m: { 60: [31, 63, 110, 168, 236], 80: [49, 88, 141, 207, 282], 100: [65, 110, 169, 240, 320], 120: [81, 129, 193, 269, 353] },
      f: { 50: [16, 40, 75, 121, 176], 70: [25, 53, 93, 144, 203], 90: [33, 65, 108, 163, 225] } },
    "machine-bicep-curl": { name: "Machine Bicep Curl", unit: "kg",
      m: { 60: [18, 30, 45, 65, 86], 80: [25, 39, 57, 79, 102], 100: [32, 48, 67, 91, 116], 120: [38, 55, 76, 101, 127] },
      f: { 50: [7, 14, 23, 35, 49], 70: [10, 17, 28, 40, 55], 90: [12, 20, 31, 45, 60] } },
    "dumbbell-shoulder-press": { name: "Dumbbell Shoulder Press", unit: "db",
      m: { 60: [10, 15, 23, 32, 43], 80: [15, 22, 31, 42, 54], 100: [20, 28, 39, 50, 63], 120: [25, 34, 45, 58, 71] },
      f: { 50: [5, 8, 13, 18, 25], 70: [7, 11, 16, 22, 29], 90: [9, 13, 19, 25, 32] } },
    "dumbbell-curl": { name: "Dumbbell Curl", unit: "db",
      m: { 60: [6, 11, 18, 26, 36], 80: [8, 14, 22, 32, 42], 100: [11, 17, 26, 36, 48], 120: [13, 20, 29, 40, 52] },
      f: { 50: [3, 6, 11, 16, 22], 70: [4, 8, 13, 19, 26], 90: [6, 10, 15, 22, 29] } },
    "incline-dumbbell-curl": { name: "Incline Dumbbell Curl", unit: "db",
      m: { 60: [7, 10, 15, 21, 27], 80: [10, 14, 20, 26, 33], 100: [12, 17, 23, 30, 38], 120: [15, 20, 27, 34, 42] },
      f: { 50: [4, 7, 10, 14, 18], 70: [6, 8, 12, 16, 20], 90: [7, 10, 14, 18, 23] } },
    "goblet-squat": { name: "Goblet Squat", unit: "db",
      m: { 60: [11, 21, 34, 51, 70], 80: [15, 26, 41, 59, 80], 100: [19, 31, 47, 66, 88], 120: [23, 36, 52, 73, 95] },
      f: { 50: [9, 16, 25, 36, 48], 70: [11, 18, 27, 38, 51], 90: [12, 19, 29, 40, 53] } },
    "pull-ups": { name: "Pull-ups (bodyweight reps)", unit: "reps", // "<1 rep" published as <1 → stored as 0.5
      m: { 60: [0.5, 7, 14, 23, 33], 80: [1, 7, 13, 21, 29], 100: [0.5, 6, 11, 18, 25], 120: [0.5, 5, 10, 16, 22] },
      f: { 50: [0.5, 0.5, 6, 13, 22], 70: [0.5, 0.5, 5, 11, 18], 90: [0.5, 0.5, 4, 9, 14] } },
    "back-extension": { name: "Back Extension (bodyweight reps)", unit: "reps",
      m: { 60: [1, 13, 30, 48, 69], 80: [5, 15, 29, 46, 63], 100: [6, 15, 28, 42, 57], 120: [6, 15, 26, 39, 52] },
      f: { 50: [4, 13, 26, 39, 54], 70: [6, 13, 23, 35, 46], 90: [6, 12, 21, 30, 40] } },
  };

  // 5K finish times by age: [Beginner, Novice, Intermediate, Advanced, Elite].
  const RUN_5K = {
    m: { 10: ["39:29", "33:53", "29:13", "25:29", "22:33"], 15: ["32:21", "27:46", "23:57", "20:53", "18:29"], 20: ["30:38", "26:18", "22:41", "19:46", "17:30"],
      25: ["30:38", "26:18", "22:41", "19:46", "17:30"], 30: ["30:50", "26:28", "22:50", "19:54", "17:37"], 35: ["31:24", "26:56", "23:14", "20:16", "17:56"],
      40: ["32:21", "27:46", "23:57", "20:52", "18:28"], 45: ["33:35", "28:49", "24:51", "21:40", "19:11"], 50: ["34:55", "29:58", "25:51", "22:32", "19:56"],
      55: ["36:22", "31:12", "26:55", "23:28", "20:46"], 60: ["37:56", "32:33", "28:04", "24:28", "21:40"], 65: ["39:38", "34:01", "29:20", "25:35", "22:38"],
      70: ["41:37", "35:43", "30:48", "26:51", "23:46"], 75: ["44:26", "38:08", "32:54", "28:41", "25:23"], 80: ["49:10", "42:12", "36:24", "31:44", "28:05"],
      85: ["56:57", "48:52", "42:09", "36:45", "32:31"], 90: ["1:09:29", "59:38", "51:26", "44:50", "39:41"] },
    f: { 10: ["45:11", "38:47", "33:19", "28:49", "25:16"], 15: ["39:47", "34:09", "29:20", "25:23", "22:14"], 20: ["37:03", "31:48", "27:19", "23:38", "20:42"],
      25: ["37:04", "31:49", "27:20", "23:39", "20:43"], 30: ["37:55", "32:33", "27:57", "24:11", "21:12"], 35: ["39:07", "33:34", "28:50", "24:57", "21:52"],
      40: ["40:23", "34:40", "29:47", "25:46", "22:35"], 45: ["41:45", "35:50", "30:47", "26:38", "23:20"], 50: ["43:12", "37:05", "31:51", "27:33", "24:09"],
      55: ["44:45", "38:25", "33:00", "28:33", "25:01"], 60: ["46:28", "39:53", "34:15", "29:38", "25:58"], 65: ["48:50", "41:55", "36:00", "31:09", "27:18"],
      70: ["52:16", "44:52", "38:32", "33:21", "29:13"], 75: ["57:10", "49:05", "42:09", "36:28", "31:58"], 80: ["1:04:19", "55:12", "47:25", "41:01", "35:57"],
      85: ["1:15:07", "1:04:29", "55:23", "47:55", "42:00"], 90: ["1:32:47", "1:19:39", "1:08:25", "59:12", "51:52"] },
  };
  const toSec = (s) => s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
  // Stored as speed-like values (1 / seconds) so "higher = better" like the lift tables.
  const RUN = {};
  for (const sex of ["m", "f"]) {
    RUN[sex] = {};
    for (const [age, row] of Object.entries(RUN_5K[sex])) RUN[sex][age] = row.map((t) => 1 / toSec(t));
  }

  // FTP W/kg category cutoffs (start of Fair, Good, Excellent, Superior).
  const BIKE = { m: [2.23, 2.79, 3.93, 5.05], f: [1.9, 2.36, 3.33, 4.3] };
  const BIKE_LABELS = ["Untrained", "Fair", "Good", "Excellent", "Superior"];

  // ---------- math ----------
  // Piecewise-linear through (xs, ys), extending the end segments beyond the data.
  function interp(xs, ys, x) {
    if (xs.length === 1) return ys[0];
    let i = 1;
    while (i < xs.length - 1 && x > xs[i]) i++;
    const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + t * (ys[i] - ys[i - 1]);
  }
  // The five level values for a given key (bodyweight or age), interpolated on a log-log scale.
  function levelsAt(table, key, lo, hi) {
    const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
    const k = Math.log(Math.min(hi, Math.max(lo, key)));
    const lx = keys.map(Math.log);
    return [0, 1, 2, 3, 4].map((j) => Math.exp(interp(lx, keys.map((kk) => Math.log(table[kk][j])), k)));
  }
  // Monotonic (log value → z) points; equal values (e.g. "<1 rep" twice) keep the higher percentile.
  function curve(levels) {
    const xs = [], zs = [];
    levels.forEach((v, j) => {
      const lv = Math.log(v);
      if (xs.length && lv <= xs[xs.length - 1]) zs[zs.length - 1] = Z[j];
      else { xs.push(lv); zs.push(Z[j]); }
    });
    return { xs, zs };
  }
  const clampZ = (z) => Math.max(-3.09, Math.min(3.09, z));
  function zFor(levels, value) {
    if (!(value > 0)) return -3.09;
    const { xs, zs } = curve(levels);
    return clampZ(interp(xs, zs, Math.log(value)));
  }
  function valueFor(levels, z) {
    const { xs, zs } = curve(levels);
    return Math.exp(interp(zs, xs, z));
  }
  // Standard normal CDF (Abramowitz–Stegun 7.1.26), in percent.
  function pct(z) {
    const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 50 * (1 + (z >= 0 ? y : -y));
  }
  const tierFromZ = (z) => 1 + TIER_Z.slice(1).filter((t) => z >= t - 1e-9).length;

  // ---------- public ----------
  /** Lift percentile. value: kg 1RM, kg of one dumbbell, or reps (see unit). */
  function strength(stdId, sex, bwKg, value) {
    const s = STRENGTH[stdId];
    if (!s || !s[sex] || !(bwKg > 0)) return null;
    const lv = levelsAt(s[sex], bwKg, 40, 160);
    const z = zFor(lv, value);
    return { z, p: pct(z), tier: tierFromZ(z) };
  }
  /** What you'd need (same units) to reach a tier (2..6) at this bodyweight. */
  function strengthTarget(stdId, sex, bwKg, tier) {
    const s = STRENGTH[stdId];
    if (!s || !s[sex] || tier < 2 || tier > 6) return null;
    return valueFor(levelsAt(s[sex], bwKg, 40, 160), TIER_Z[tier - 1]);
  }
  /** Running percentile from a 5K-equivalent time in seconds. */
  function run(sex, age, t5kSec) {
    if (!RUN[sex] || !(age > 0) || !(t5kSec > 0)) return null;
    const z = zFor(levelsAt(RUN[sex], age, 10, 90), 1 / t5kSec);
    return { z, p: pct(z), tier: tierFromZ(z) };
  }
  function runTarget(sex, age, tier) {
    if (!RUN[sex] || tier < 2 || tier > 6) return null;
    return 1 / valueFor(levelsAt(RUN[sex], age, 10, 90), TIER_Z[tier - 1]); // seconds
  }
  /** Riegel: predict a 5K time from any run of at least 1.6 km (assumes a hard, steady effort). */
  function fiveKEquivalent(km, minutes) {
    if (!(km >= 1.6) || !(minutes > 0)) return null;
    return minutes * 60 * Math.pow(5 / km, 1.06);
  }
  /** Bike: FTP W/kg → Coggan category as tier 1..5 (no percentile available). */
  function bike(sex, wkg) {
    const cut = BIKE[sex];
    if (!cut || !(wkg > 0)) return null;
    const tier = 1 + cut.filter((c) => wkg >= c).length;
    return { tier, label: BIKE_LABELS[tier - 1], wkg };
  }
  const bikeTarget = (sex, tier) => (BIKE[sex] && tier >= 2 && tier <= 5 ? BIKE[sex][tier - 2] : null);

  const LIST = Object.entries(STRENGTH).map(([id, s]) => ({ id, name: s.name, unit: s.unit }))
    .sort((a, b) => a.name.localeCompare(b.name));

  window.Standards = { STRENGTH, LIST, TIER_P, BIKE_LABELS, strength, strengthTarget, run, runTarget, fiveKEquivalent, bike, bikeTarget, pct };
})();
