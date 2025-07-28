function flattenParams(params) {
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

    return flat;
}

function noteToMidi(note) {
    const match = /^([A-Ga-g])(\d+)$/.exec(note); // e.g. C4, D3
    if (!match) return null;

    const [, letter, octaveStr] = match;
    const baseNotes = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const semitone = baseNotes[letter.toUpperCase()];
    const octave = parseInt(octaveStr, 10);

    return 12 * (octave + 1) + semitone;
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
};

export function calculateSimilarityScore(current, target) {
    const flatCurrent = flattenParams(current);
    const flatTarget = flattenParams(target);

    const numericKeys = Object.keys(flatTarget).filter(
        key => typeof flatTarget[key] === 'number' && typeof flatCurrent[key] === 'number'
    );

    if (numericKeys.length === 0) return 0;

    let totalSimilarity = 0;
    let totalWeight = 0;

    // Oscillator Type (2x)
    if (current.oscillator && target.oscillator) {
        const oscSim = current.oscillator === target.oscillator ? 1 : 0;
        totalSimilarity += oscSim * 2;
        totalWeight += 2;
    }

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

    // Numeric Parameters (1x each)
    for (let key of numericKeys) {
        const maxRange = MAX_RANGES[key] ?? 1;
        const diff = Math.abs(flatCurrent[key] - flatTarget[key]);
        const similarity = Math.max(0, 1 - (diff / maxRange));
        totalSimilarity += similarity;
        totalWeight += 1;
    }

    const averageSimilarity = totalSimilarity / totalWeight;
    return averageSimilarity * 100;
}

export function getSimilarityBreakdown(current, target) {
    const flatCurrent = flattenParams(current);
    const flatTarget = flattenParams(target);

    const result = {};

    // Categorical similarities
    result.oscillator = current.oscillator === target.oscillator ? 1 : 0;
    result.filter_type = filterTypeSimilarity(current, target);
    result.note = noteSimilarity(current.note, target.note);
    result.duration = durationSimilarity(current.duration, target.duration);

    // Numeric fields
    const numericKeys = Object.keys(flatTarget).filter(
        key => typeof flatTarget[key] === 'number' && typeof flatCurrent[key] === 'number'
    );

    for (let key of numericKeys) {
        const maxRange = MAX_RANGES[key] ?? 1;
        const diff = Math.abs(flatCurrent[key] - flatTarget[key]);
        const similarity = Math.max(0, 1 - (diff / maxRange));
        result[key] = similarity;
    }

    return result;
}
