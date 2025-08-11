import * as Tone from 'tone';

const PlayPatch = async (patch) => {
    await Tone.start();

    const params = patch.parameters || {};
    const note = patch.note || 'C4';
    const duration = patch.duration || '8n';

    const env = params.envelope || {};
    const filterParams = params.filter || {};
    const portamento = params.portamento ?? 0; // seconds (0 = no glide)
    const noiseLevel = params.noiseLevel ?? -60;

    // Envelope
    const envelope = new Tone.AmplitudeEnvelope({
        attack: env.attack ?? 0.1,
        decay: env.decay ?? 0.2,
        sustain: env.sustain ?? 0.7,
        release: env.release ?? 0.5,
    });

    // Filter (optional)
    let filter = null;
    if (filterParams.type && filterParams.type !== 'none') {
        let frequency = 1000;
        if (filterParams.type === 'bandpass') {
            const low = filterParams.bandLow ?? 300;
            const high = filterParams.bandHigh ?? 3000;
            frequency = (low + high) / 2;
        } else {
            frequency = filterParams.cutoff ?? 1000;
        }
        filter = new Tone.Filter({
            type: filterParams.type,
            frequency,
            Q: filterParams.resonance ?? 1,
        });
        filter.connect(envelope);
    }

    envelope.toDestination();

    // Oscillators (multi-osc) with legacy fallback
    const oscDefs = params.oscillators || [{
        type: params.oscillator || 'sine',
        frequency: Tone.Frequency(note).toFrequency(), // legacy target
        gain: 1,
        detune: params.detune ?? 0
    }];

    const now = Tone.now();

    const oscillators = oscDefs.map(def => {
        const targetFreq = (def.frequency != null)
            ? def.frequency
            : Tone.Frequency(note).toFrequency();

        // If slideFrom is provided and portamento > 0, start there; else start at target
        const startFreq = (portamento > 0 && def.slideFrom != null)
            ? def.slideFrom
            : targetFreq;

        const osc = new Tone.Oscillator({
            type: def.type,
            frequency: startFreq,
            detune: def.detune || 0
        });

        const gain = new Tone.Gain(def.gain ?? 1);
        osc.connect(gain);
        (filter ? gain.connect(filter) : gain.connect(envelope));

        // Schedule the glide after start if needed
        if (portamento > 0 && startFreq !== targetFreq) {
            // Use an exponential ramp for a natural glide
            osc.frequency.exponentialRampToValueAtTime(targetFreq, now + portamento);
        }

        return { osc, gain };
    });

    // Noise (optional)
    const noise = new Tone.Noise('white');
    noise.volume.value = noiseLevel;
    if (noiseLevel > -60) {
        (filter ? noise.connect(filter) : noise.connect(envelope));
    }

    // Start and trigger
    oscillators.forEach(({ osc }) => osc.start(now));
    envelope.triggerAttackRelease(duration, now);

    if (noiseLevel > -60) {
        noise.start(now);
        noise.stop(now + Tone.Time(duration).toSeconds());
    }

    // Stop oscillators after duration (with a tiny safety margin)
    const stopAt = now + Tone.Time(duration).toSeconds() + 0.01;
    oscillators.forEach(({ osc }) => osc.stop(stopAt));
};

export default PlayPatch;
