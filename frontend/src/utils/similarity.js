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
  resonance: 1e-2,
  masterGain: 1e-3     // Add Master Gain tolerance
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

  // Remove old single filter handling since we now have per-oscillator filters
  delete flat.filter;

  // Expose up to two oscillators' numeric fields and their filters
  if (Array.isArray(params.oscillators) && params.oscillators.length) {
    const oscs = params.oscillators.slice(0, 2);
    oscs.forEach((o, i) => {
      const idx = i + 1;
      
      // Oscillator parameters
      if (isNumber(o?.gain))       flat[`osc${idx}_gain`] = o.gain;
      if (isNumber(o?.detune))     flat[`osc${idx}_detune`] = o.detune;
      if (isNumber(o?.frequency))  flat[`osc${idx}_frequency`] = o.frequency;
      if (isNumber(o?.slideFrom))  flat[`osc${idx}_slideFrom`] = o.slideFrom;
      
      // Oscillator filter parameters
      if (o?.filter) {
        const f = o.filter;
        if (isNumber(f?.resonance)) flat[`osc${idx}_filter_resonance`] = f.resonance;
        if (isNumber(f?.cutoff))    flat[`osc${idx}_filter_cutoff`] = f.cutoff;
        if (isNumber(f?.bandLow))   flat[`osc${idx}_filter_bandLow`] = f.bandLow;
        if (isNumber(f?.bandHigh))  flat[`osc${idx}_filter_bandHigh`] = f.bandHigh;
      }
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

// ---- Enhanced Filter type similarity with frequency awareness ----
function filterTypeSimilarity(currentOsc, targetOsc) {
  const c = currentOsc?.filter;
  const t = targetOsc?.filter;
  
  // Both have no filter
  if (!c?.type && !t?.type) return 1;
  // One has filter, other doesn't - heavy penalty
  if (!c?.type || !t?.type) return 0.1;
  
  // Same filter type - perfect
  if (c.type === t.type) return 1;

  // Special cases where different filter types can be similar if frequencies match well
  if (t.type === 'lowpass' && c.type === 'bandpass') {
    // Bandpass with low band <= 100Hz and high band close to lowpass cutoff
    if (c.bandLow <= 100 && Math.abs(c.bandHigh - t.cutoff) < 200) {
      return 0.8; // Very similar
    }
    return 0.3; // Some partial credit
  }

  if (t.type === 'highpass' && c.type === 'bandpass') {
    // Bandpass with high band >= 10000Hz and low band close to highpass cutoff
    if (c.bandHigh >= 10000 && Math.abs(c.bandLow - t.cutoff) < 200) {
      return 0.8; // Very similar
    }
    return 0.3; // Some partial credit
  }

  if (t.type === 'bandpass' && c.type === 'lowpass') {
    // Lowpass cutoff close to bandpass high frequency
    if (Math.abs(c.cutoff - t.bandHigh) < 200) {
      return 0.7; // Similar
    }
    return 0.2; // Minimal credit
  }

  if (t.type === 'bandpass' && c.type === 'highpass') {
    // Highpass cutoff close to bandpass low frequency
    if (Math.abs(c.cutoff - t.bandLow) < 200) {
      return 0.7; // Similar
    }
    return 0.2; // Minimal credit
  }

  return 0.1; // Default minimal credit for completely different types
}

// ---------- Oscillator-aware similarity helpers ----------
function asOscArray(p = {}) {
  // Preferred multi-osc shape
  if (Array.isArray(p.oscillators) && p.oscillators.length) {
    return p.oscillators.slice(0, 2).map(o => ({
      type: o?.type ?? 'sine',
      gain: isNumber(o?.gain) ? o.gain : 1,
      detune: isNumber(o?.detune) ? o.detune : 0,
      frequency: isNumber(o?.frequency) ? o.frequency : null,
      slideFrom: isNumber(o?.slideFrom) ? o.slideFrom : null,
      filter: o?.filter || null
    }));
  }
  // Legacy single-osc payload
  const legacy = {
    type: p.oscillator || 'sine',
    gain: isNumber(p?.gain) ? p.gain : 1,
    detune: isNumber(p?.detune) ? p.detune : 0,
    frequency: isNumber(p?.frequency) ? p.frequency : null,
    slideFrom: isNumber(p?.slideFrom) ? p.slideFrom : null,
    filter: p.filter || null
  };
  return [legacy];
}

// Epsilon-aware subsims
function typeSim(a = 'sine', b = 'sine') { 
  return a === b ? 1 : 0; // No partial credit for oscillator types - this is critical
}

function gainSim(a = 1, b = 1) {
  if (approxEqual(a, b, EPS.gain)) return 1;
  return Math.max(0, clamp01(1 - Math.abs(a - b) / 2));
}

function detuneSim(a = 0, b = 0) {
  if (approxEqual(a, b, EPS.detune)) return 1;
  const diff = Math.abs(a - b);
  if (diff <= 5) return 1;
  if (diff >= 100) return 0;
  return Math.max(0, 1 - (diff - 5) / 95);
}

function freqSim(aHz, bHz) {
  if (aHz == null && bHz == null) return 1;
  if (aHz == null || bHz == null) return 0.7;
  if (approxEqual(aHz, bHz, EPS.frequency)) return 1;
  const cents = Math.abs(1200 * Math.log(aHz / bHz) / Math.log(2));
  return Math.max(0, Math.exp(-(cents * cents) / (2 * 35 * 35)));
}

function slideFromSim(aHz, bHz, portaA = 0, portaB = 0) {
  if ((portaA ?? 0) <= 0 && (portaB ?? 0) <= 0) return 1;
  if (aHz == null && bHz == null) return 1;
  if (aHz == null || bHz == null) return 0.6;
  if (approxEqual(aHz, bHz, EPS.slideFrom)) return 1;
  const base = Math.max(50, Math.max(Math.abs(aHz), Math.abs(bHz)));
  return Math.max(0, clamp01(1 - Math.abs(aHz - bHz) / base));
}

// Filter parameter similarity with frequency awareness
function filterCutoffSim(currentFilter, targetFilter) {
  if (!currentFilter || !targetFilter) return 0;
  
  if (targetFilter.type === 'lowpass' || targetFilter.type === 'highpass') {
    if (currentFilter.type === targetFilter.type) {
      // Same type - compare cutoff directly
      return Math.max(0, 1 - Math.abs(currentFilter.cutoff - targetFilter.cutoff) / 2000);
    } else if (targetFilter.type === 'lowpass' && currentFilter.type === 'bandpass') {
      // Compare lowpass cutoff to bandpass high frequency
      return Math.max(0, 1 - Math.abs(currentFilter.bandHigh - targetFilter.cutoff) / 2000);
    } else if (targetFilter.type === 'highpass' && currentFilter.type === 'bandpass') {
      // Compare highpass cutoff to bandpass low frequency
      return Math.max(0, 1 - Math.abs(currentFilter.bandLow - targetFilter.cutoff) / 2000);
    }
  } else if (targetFilter.type === 'bandpass') {
    if (currentFilter.type === 'bandpass') {
      // Compare both band edges
      const lowSim = Math.max(0, 1 - Math.abs(currentFilter.bandLow - targetFilter.bandLow) / 1000);
      const highSim = Math.max(0, 1 - Math.abs(currentFilter.bandHigh - targetFilter.bandHigh) / 1000);
      return (lowSim + highSim) / 2;
    } else if (currentFilter.type === 'lowpass') {
      // Bandpass high vs lowpass cutoff
      return Math.max(0, 1 - Math.abs(currentFilter.cutoff - targetFilter.bandHigh) / 2000);
    } else if (currentFilter.type === 'highpass') {
      // Bandpass low vs highpass cutoff
      return Math.max(0, 1 - Math.abs(currentFilter.cutoff - targetFilter.bandLow) / 2000);
    }
  }
  
  return 0;
}

function filterResonanceSim(currentFilter, targetFilter) {
  if (!currentFilter || !targetFilter) return 0;
  if (approxEqual(currentFilter.resonance, targetFilter.resonance, EPS.resonance)) return 1;
  return Math.max(0, 1 - Math.abs(currentFilter.resonance - targetFilter.resonance) / 10);
}

/**
 * Individual oscillator scoring with heavy emphasis on type and filter frequencies
 */
function scoreIndividualOscillator(currentOsc, targetOsc) {
  if (!currentOsc || !targetOsc) return 0;
  
  const w = {
    type: 0.4,        // HEAVY weight on oscillator type (40%)
    freq: 0.15,       // Frequency
    detune: 0.1,      // Detune
    gain: 0.1,        // Gain
    slideFrom: 0.05,  // Slide from
    filterType: 0.1,  // Filter type
    filterFreq: 0.08, // Filter frequencies (very important)
    filterRes: 0.02   // Filter resonance
  };
  
  let score = 0;
  
  // Oscillator type is critical
  score += w.type * typeSim(currentOsc.type, targetOsc.type);
  
  // Other oscillator parameters
  score += w.freq * freqSim(currentOsc.frequency, targetOsc.frequency);
  score += w.detune * detuneSim(currentOsc.detune, targetOsc.detune);
  score += w.gain * gainSim(currentOsc.gain, targetOsc.gain);
  score += w.slideFrom * slideFromSim(currentOsc.slideFrom, targetOsc.slideFrom);
  
  // Filter scoring
  score += w.filterType * filterTypeSimilarity(currentOsc, targetOsc);
  score += w.filterFreq * filterCutoffSim(currentOsc.filter, targetOsc.filter);
  score += w.filterRes * filterResonanceSim(currentOsc.filter, targetOsc.filter);
  
  return Math.max(0, score);
}

/**
 * Oscillator section scoring: 1/3 per oscillator, order doesn't matter
 */
function oscillatorsSimilarity(current, target) {
  const A = asOscArray(current);
  const B = asOscArray(target);
  
  // If counts don't match, severe penalty
  if (A.length !== B.length) {
    const minCount = Math.min(A.length, B.length);
    let totalScore = 0;
    
    // Score the oscillators that exist in both
    for (let i = 0; i < minCount; i++) {
      totalScore += scoreIndividualOscillator(A[i], B[i]);
    }
    
    // Average score for existing oscillators, then apply count mismatch penalty
    const avgScore = minCount > 0 ? totalScore / minCount : 0;
    return Math.max(0, avgScore * 0.5); // 50% penalty for count mismatch
  }
  
  // Counts match - find best pairing
  if (A.length === 1 && B.length === 1) {
    return scoreIndividualOscillator(A[0], B[0]);
  }
  
  if (A.length === 2 && B.length === 2) {
    // Try both pairings and take the best
    const pairing1 = scoreIndividualOscillator(A[0], B[0]) + scoreIndividualOscillator(A[1], B[1]);
    const pairing2 = scoreIndividualOscillator(A[0], B[1]) + scoreIndividualOscillator(A[1], B[0]);
    return Math.max(pairing1, pairing2) / 2; // Average of best pairing
  }
  
  return 0;
}

/**
 * Envelope & Global section scoring (1/3 of total score)
 */
function envelopeGlobalSimilarity(current, target) {
  const flatCurrent = flattenParams(current);
  const flatTarget = flattenParams(target);
  
  const params = [
    'env_attack', 'env_decay', 'env_sustain', 'env_release',
    'portamento', 'noiseLevel', 'masterGain'
  ];
  
  let totalScore = 0;
  let totalWeight = 0;
  
  for (const param of params) {
    const currentVal = flatCurrent[param];
    const targetVal = flatTarget[param];
    
    if (isNumber(currentVal) && isNumber(targetVal)) {
      let similarity = 0;
      
      if (param.startsWith('env_')) {
        // Envelope parameters
        if (approxEqual(currentVal, targetVal, EPS.env)) {
          similarity = 1;
        } else {
          const maxRange = param === 'env_sustain' ? 1 : 2;
          similarity = Math.max(0, 1 - Math.abs(currentVal - targetVal) / maxRange);
        }
      } else if (param === 'portamento') {
        // Portamento
        if (approxEqual(currentVal, targetVal, EPS.portamento)) {
          similarity = 1;
        } else {
          similarity = Math.max(0, 1 - Math.abs(currentVal - targetVal));
        }
      } else if (param === 'noiseLevel') {
        // Noise level
        if (approxEqual(currentVal, targetVal, EPS.noiseLevel)) {
          similarity = 1;
        } else {
          similarity = Math.max(0, 1 - Math.abs(currentVal - targetVal) / 60);
        }
      } else if (param === 'masterGain') {
        // Master gain
        if (approxEqual(currentVal, targetVal, EPS.masterGain)) {
          similarity = 1;
        } else {
          similarity = Math.max(0, 1 - Math.abs(currentVal - targetVal) / 2);
        }
      }
      
      totalScore += similarity;
      totalWeight += 1;
    }
  }
  
  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

// ---------------------------------------------------------------------------

// ---- Public API ----
export function calculateSimilarityScore(current, target) {
  // 2/3 from oscillators, 1/3 from envelope & global
  const oscillatorScore = oscillatorsSimilarity(current, target);
  const envelopeGlobalScore = envelopeGlobalSimilarity(current, target);
  
  const totalScore = (oscillatorScore * 2 + envelopeGlobalScore) / 3;
  
  return Math.max(0, totalScore * 100);
}

export function getSimilarityBreakdown(current, target, { debug = false } = {}) {
  const A = asOscArray(current);
  const B = asOscArray(target);
  
  const result = {
    // Overall section scores
    oscillators: oscillatorsSimilarity(current, target),
    envelopeGlobal: envelopeGlobalSimilarity(current, target),
    
    // Individual oscillator scores
    oscillator1: A.length >= 1 && B.length >= 1 ? scoreIndividualOscillator(A[0], B[0]) : 0,
    oscillator2: A.length >= 2 && B.length >= 2 ? scoreIndividualOscillator(A[1], B[1]) : 0,
    
    // Note and duration
    note: noteSimilarity(current.note, target.note),
    duration: durationSimilarity(current.duration, target.duration)
  };

  if (debug) {
    // eslint-disable-next-line no-console
    console.log('breakdown', result);
  }

  return result;
}