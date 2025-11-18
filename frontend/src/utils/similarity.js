// ---- Tolerances to eliminate tiny numeric jitters ----
const EPS = {
  default: 1e-6,
  gain: 1e-3,          // 0..2 UI
  detune: 0.5,         // cents
  frequency: 0.1,      // Hz
  slideFrom: 0.1,      // Hz
  portamento: 1e-3,    // seconds
  noiseLevel: 1e-3,    // dB
  env: 1e-3,           // seconds / unit
  cutoff: 1,           // Hz
  band: 1,             // Hz
  resonance: 1e-2
};

function approxEqual(a, b, eps = EPS.default) {
  return Math.abs((a ?? 0) - (b ?? 0)) <= eps;
}

// ---------- Utils ----------
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const isNumber = (v) => typeof v === 'number';

// ---- Flatteners ----
function flattenParams(params = {}) {
  const flat = { ...params };

  if (params.envelope) {
    for (const [k, v] of Object.entries(params.envelope)) {
      flat[`env_${k}`] = v;
    }
    delete flat.envelope;
  }

  if (params.filter) {
    for (const [k, v] of Object.entries(params.filter)) {
      flat[`filter_${k}`] = v;
    }
    delete flat.filter;
  }

  // Expose up to two oscillators' numeric fields (we may skip them in scoring to avoid double-counting)
  if (Array.isArray(params.oscillators) && params.oscillators.length) {
    const oscs = params.oscillators.slice(0, 2);
    oscs.forEach((o, i) => {
      const idx = i + 1;
      if (isNumber(o?.gain))       flat[`osc${idx}_gain`] = o.gain;
      if (isNumber(o?.detune))     flat[`osc${idx}_detune`] = o.detune;
      if (isNumber(o?.frequency))  flat[`osc${idx}_frequency`] = o.frequency;
      if (isNumber(o?.slideFrom))  flat[`osc${idx}_slideFrom`] = o.slideFrom;
      // type remains categorical, handled in oscillator section
    });
  }

  return flat;
}

// ---- Note helpers (now supports sharps/flats) ----
function noteToMidi(note) {
  const m = /^([A-Ga-g])([#b]?)(\d+)$/.exec((note ?? '').trim());
  if (!m) return null;
  const [, L, acc, octStr] = m;
  const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[L.toUpperCase()];
  const adj = acc === '#' ? 1 : acc === 'b' ? -1 : 0;
  const octave = parseInt(octStr, 10);
  return 12 * (octave + 1) + base + adj;
}

function noteSimilarity(a, b) {
  const midiA = noteToMidi(a);
  const midiB = noteToMidi(b);
  if (midiA === null || midiB === null) return 0;

  const diff = Math.abs(midiA - midiB);
  if (diff === 0) return 1.0;
  if (diff === 1) return 0.9;
  if (diff === 2) return 0.8;
  if (diff <= 4) return 0.6;
  if (diff <= 7) return 0.4;
  return 0;
}

// ---- Duration similarity ----
function durationSimilarity(a, b) {
  const values = {
    '1n': 1.0,
    '2n': 0.5,
    '4n': 0.25,
    '8n': 0.125,
    '16n': 0.0625,
    '32n': 0.03125,
  };

  const valA = values[a];
  const valB = values[b];
  if (!valA || !valB) return 0;

  const diff = Math.abs(valA - valB);

  if (diff === 0) return 1.0;
  if (diff <= 0.03125) return 0.85;
  if (diff <= 0.0625) return 0.7;
  if (diff <= 0.125) return 0.5;
  return 0;
}

// ---- Filter type similarity ----
function filterTypeSimilarity(current, target) {
  const c = current.filter;
  const t = target.filter;
  if (!c?.type || !t?.type) return 0;

  if (c.type === t.type) return 1;

  if (
    t.type === 'lowpass' &&
    c.type === 'bandpass' &&
    c.bandLow <= 0 &&
    Math.abs(c.bandHigh - t.cutoff) < 100
  ) return 0.8;

  if (
    t.type === 'highpass' &&
    c.type === 'bandpass' &&
    c.bandHigh >= 10000 &&
    Math.abs(c.bandLow - t.cutoff) < 100
  ) return 0.8;

  return 0;
}

// ---------- Oscillator-aware similarity helpers ----------
function asOscArray(p = {}) {
  // Preferred multi-osc shape
  if (Array.isArray(p.oscillators) && p.oscillators.length) {
    return p.oscillators.slice(0, 2).map(o => ({
      type: o?.type ?? 'sine',
      gain: isNumber(o?.gain) ? o.gain : 1,
      detune: isNumber(o?.detune) ? o.detune : 0,               // cents
      frequency: isNumber(o?.frequency) ? o.frequency : null,   // null = follow note
      slideFrom: isNumber(o?.slideFrom) ? o.slideFrom : null,
    }));
  }
  // Legacy single-osc payload
  const legacy = {
    type: p.oscillator || 'sine',
    gain: isNumber(p?.gain) ? p.gain : 1,
    detune: isNumber(p?.detune) ? p.detune : 0,
    frequency: isNumber(p?.frequency) ? p.frequency : null,
    slideFrom: isNumber(p?.slideFrom) ? p.slideFrom : null,
  };
  return [legacy];
}

// Epsilon-aware subsims
function typeSim(a = 'sine', b = 'sine') { return a === b ? 1 : 0; }

function gainSim(a = 1, b = 1) {
  if (approxEqual(a, b, EPS.gain)) return 1;
  return clamp01(1 - Math.abs(a - b) / 2); // assumes UI 0..2
}

function detuneSim(a = 0, b = 0) {
  if (approxEqual(a, b, EPS.detune)) return 1;
  const diff = Math.abs(a - b);          // cents
  if (diff <= 5) return 1;
  if (diff >= 100) return 0;
  return 1 - (diff - 5) / 95;
}

function freqSim(aHz, bHz) {
  if (aHz == null && bHz == null) return 1;     // both follow note
  if (aHz == null || bHz == null) return 0.7;   // partial credit
  if (approxEqual(aHz, bHz, EPS.frequency)) return 1;
  const cents = Math.abs(1200 * Math.log(aHz / bHz) / Math.log(2));
  return Math.exp(-(cents * cents) / (2 * 35 * 35));
}

// Portamento-aware slideFrom similarity:
// If both portamentos are effectively zero, glide never triggers, so treat slideFrom as perfect.
function slideFromSim(aHz, bHz, portaA = 0, portaB = 0) {
  if ((portaA ?? 0) <= 0 && (portaB ?? 0) <= 0) return 1;
  if (aHz == null && bHz == null) return 1;
  if (aHz == null || bHz == null) return 0.6;
  if (approxEqual(aHz, bHz, EPS.slideFrom)) return 1;
  const base = Math.max(50, Math.max(Math.abs(aHz), Math.abs(bHz)));
  return clamp01(1 - Math.abs(aHz - bHz) / base);
}

function oscPairSim(oscA = {}, oscB = {}, portaA = 0, portaB = 0) {
  const w = { type: 0.2, freq: 0.25, detune: 0.2, gain: 0.25, slideFrom: 0.1 };
  return (
    w.type      * typeSim(oscA.type,       oscB.type) +
    w.freq      * freqSim(oscA.frequency,  oscB.frequency) +
    w.detune    * detuneSim(oscA.detune,   oscB.detune) +
    w.gain      * gainSim(oscA.gain,       oscB.gain) +
    w.slideFrom * slideFromSim(oscA.slideFrom, oscB.slideFrom, portaA, portaB)
  );
}

/**
 * Order-agnostic oscillator section:
 *  - best pairing across 1–2 oscs
 *  - modest penalty for unpaired extras, scaled by their gain
 * Returns 0..1
 */
function oscillatorsSimilarity(current, target) {
  const portaA = current?.portamento ?? 0;
  const portaB = target?.portamento ?? 0;
  const A = asOscArray(current);
  const B = asOscArray(target);

  // Single↔single fast path
  if (A.length === 1 && B.length === 1) {
    return oscPairSim(A[0], B[0], portaA, portaB);
  }

  const candidates = [
    { pairing: [[0, 0], [1, 1]], score: 0 },
    { pairing: [[0, 1], [1, 0]], score: 0 },
  ];

  candidates.forEach(c => {
    c.score = c.pairing.reduce((acc, [i, j]) => (
      A[i] && B[j] ? acc + oscPairSim(A[i], B[j], portaA, portaB) : acc
    ), 0);
  });

  let best = candidates[0].score >= candidates[1].score ? candidates[0] : candidates[1];
  best.pairing = best.pairing.filter(([i, j]) => A[i] && B[j]);
  const pairsCount = best.pairing.length || 1;
  const avgPairScore = best.score / pairsCount;

  // orphan penalty (scaled by gain; quiet extras hurt less)
  const gainOf = (o) => Math.max(0, Math.min(2, o?.gain ?? 1));
  const aOrphans = A.filter((_, i) => !best.pairing.some(([ii]) => ii === i));
  const bOrphans = B.filter((_, j) => !best.pairing.some(([, jj]) => jj === j));
  const orphanRaw =
    (aOrphans.reduce((s, o) => s + gainOf(o) / 2, 0) / Math.max(1, aOrphans.length || 1)) +
    (bOrphans.reduce((s, o) => s + gainOf(o) / 2, 0) / Math.max(1, bOrphans.length || 1));
  const orphanPenalty = clamp01(0.3 * orphanRaw);

  return clamp01(avgPairScore - orphanPenalty);
}

// ---------------------------------------------------------------------------

const MAX_RANGES = {
  detune: 2400,
  portamento: 1,
  noiseLevel: 60,
  'env_attack': 2,
  'env_decay': 2,
  'env_sustain': 1,
  'env_release': 3,
  'filter_resonance': 10,
  'filter_cutoff': 10000,
  'filter_bandLow': 10000,
  'filter_bandHigh': 10000,

  // Ranges for flattened oscillator numerics (if present)
  'osc1_gain': 2,
  'osc2_gain': 2,
  'osc1_detune': 2400,
  'osc2_detune': 2400,
  'osc1_frequency': 8000, // linear compare in numeric loop
  'osc2_frequency': 8000,
  'osc1_slideFrom': 8000,
  'osc2_slideFrom': 8000,
};

// ---- Public API ----
export function calculateSimilarityScore(current, target) {
  const flatCurrent = flattenParams(current);
  const flatTarget  = flattenParams(target);

  const portaBothZero =
    ((current?.portamento ?? flatCurrent.portamento ?? 0) <= 0) &&
    ((target?.portamento ?? flatTarget.portamento ?? 0) <= 0);

  // Skip keys that would double-count oscillator attributes (including legacy top-level fields)
  const skipOscNumeric = (k) =>
    /^osc[12]_(gain|detune|frequency|slideFrom)$/.test(k) ||
    k === 'detune' || k === 'gain' || k === 'frequency' || k === 'slideFrom';

  // Also skip slideFrom if both portamentos are effectively zero (inaudible)
  const skipIfInaudibleGlide = (k) => portaBothZero && /^osc[12]_slideFrom$/.test(k);

  const numericKeys = Object.keys(flatTarget).filter(
    (key) =>
      isNumber(flatTarget[key]) &&
      isNumber(flatCurrent[key]) &&
      !skipOscNumeric(key) &&
      !skipIfInaudibleGlide(key) &&
      !(key === 'portamento' && portaBothZero)
  );

  let totalSimilarity = 0;
  let totalWeight = 0;

  // Oscillators section (2x)
  const oscSection = oscillatorsSimilarity(current, target); // 0..1
  totalSimilarity += oscSection * 2;
  totalWeight += 2;

  // Filter Type (2x)
  const filterSim = filterTypeSimilarity(current, target);
  totalSimilarity += filterSim * 2;
  totalWeight += 2;

  // Note (2x)
  if (current.note && target.note) {
    const noteSim = noteSimilarity(current.note, target.note);
    totalSimilarity += noteSim * 2;
    totalWeight += 2;
  }

  // Duration (1.5x)
  if (current.duration && target.duration) {
    const durSim = durationSimilarity(current.duration, target.duration);
    totalSimilarity += durSim * 1.5;
    totalWeight += 1.5;
  }

  // Numeric Parameters (1x each) with epsilon-aware perfect matches
  for (let key of numericKeys) {
    const maxRange = MAX_RANGES[key] ?? 1;
    const a = flatCurrent[key];
    const b = flatTarget[key];

    // pick per-key epsilon
    let e = EPS.default;
    if (key.includes('gain')) e = EPS.gain;
    else if (key.includes('detune')) e = EPS.detune;
    else if (key.includes('frequency')) e = EPS.frequency;
    else if (key.includes('slideFrom')) e = EPS.slideFrom;
    else if (key === 'portamento') e = EPS.portamento;
    else if (key === 'noiseLevel') e = EPS.noiseLevel;
    else if (key.startsWith('env_')) e = EPS.env;
    else if (key === 'filter_cutoff') e = EPS.cutoff;
    else if (key === 'filter_bandLow' || key === 'filter_bandHigh') e = EPS.band;
    else if (key === 'filter_resonance') e = EPS.resonance;

    const similarity = approxEqual(a, b, e)
      ? 1
      : Math.max(0, 1 - (Math.abs(a - b) / maxRange));

    totalSimilarity += similarity;
    totalWeight += 1;
  }

  const averageSimilarity = totalWeight > 0 ? (totalSimilarity / totalWeight) : 0;
  return averageSimilarity * 100;
}

export function getSimilarityBreakdown(current, target, { debug = false } = {}) {
  const flatCurrent = flattenParams(current);
  const flatTarget  = flattenParams(target);

  const portaBothZero =
    ((current?.portamento ?? flatCurrent.portamento ?? 0) <= 0) &&
    ((target?.portamento ?? flatTarget.portamento ?? 0) <= 0);

  const result = {};

  // Multi-osc score
  result.oscillators = oscillatorsSimilarity(current, target); // 0..1

  // Categorical similarities
  result.filter_type = filterTypeSimilarity(current, target);
  result.note = noteSimilarity(current.note, target.note);
  result.duration = durationSimilarity(current.duration, target.duration);

  // Numeric fields (epsilon-aware), skipping oscillator-double-counts and inaudible glide
  const skipOscNumeric = (k) =>
    /^osc[12]_(gain|detune|frequency|slideFrom)$/.test(k) ||
    k === 'detune' || k === 'gain' || k === 'frequency' || k === 'slideFrom';
  const skipIfInaudibleGlide = (k) => portaBothZero && /^osc[12]_slideFrom$/.test(k);

  const numericKeys = Object.keys(flatTarget).filter(
    (key) =>
      isNumber(flatTarget[key]) &&
      isNumber(flatCurrent[key]) &&
      !skipOscNumeric(key) &&
      !skipIfInaudibleGlide(key) &&
      !(key === 'portamento' && portaBothZero)
  );

  for (let key of numericKeys) {
    const maxRange = MAX_RANGES[key] ?? 1;
    const a = flatCurrent[key];
    const b = flatTarget[key];

    let e = EPS.default;
    if (key.includes('gain')) e = EPS.gain;
    else if (key.includes('detune')) e = EPS.detune;
    else if (key.includes('frequency')) e = EPS.frequency;
    else if (key.includes('slideFrom')) e = EPS.slideFrom;
    else if (key === 'portamento') e = EPS.portamento;
    else if (key === 'noiseLevel') e = EPS.noiseLevel;
    else if (key.startsWith('env_')) e = EPS.env;
    else if (key === 'filter_cutoff') e = EPS.cutoff;
    else if (key === 'filter_bandLow' || key === 'filter_bandHigh') e = EPS.band;
    else if (key === 'filter_resonance') e = EPS.resonance;

    result[key] = approxEqual(a, b, e)
      ? 1
      : Math.max(0, 1 - (Math.abs(a - b) / maxRange));
  }

  if (debug) {
    // eslint-disable-next-line no-console
    console.log('breakdown', result);
  }

  return result;
}
