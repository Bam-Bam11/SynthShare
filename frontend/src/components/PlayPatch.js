import * as Tone from 'tone';

const PlayPatch = async (patch) => {
    await Tone.start();

    const params = patch.parameters || {};
    const duration = patch.duration || '8n';

    const env = params.envelope || {};
    const portamento = params.portamento ?? 0;
    const noiseLevel = params.noiseLevel ?? -60;
    const masterGain = params.masterGain ?? 1; // Add this line

    // Envelope
    const envelope = new Tone.AmplitudeEnvelope({
        attack: env.attack ?? 0.1,
        decay: env.decay ?? 0.2,
        sustain: env.sustain ?? 0.7,
        release: env.release ?? 0.5,
    });

    // Add master gain
    const master = new Tone.Gain(masterGain);
    envelope.connect(master);
    master.toDestination();

    // Helper function to create filter
    const createFilter = (filterParams) => {
        if (!filterParams || filterParams.type === 'none') return null;
        
        let frequency = 1000;
        if (filterParams.type === 'bandpass') {
            const low = filterParams.bandLow ?? 300;
            const high = filterParams.bandHigh ?? 3000;
            frequency = (low + high) / 2;
        } else {
            frequency = filterParams.cutoff ?? 1000;
        }
        
        return new Tone.Filter({
            type: filterParams.type,
            frequency,
            Q: filterParams.resonance ?? 1,
        });
    };

    // Oscillators - only new format supported
    const oscDefs = params.oscillators || [];

    const now = Tone.now();

    const oscillators = oscDefs.map((def) => {
        const targetFreq = def.frequency ?? 440;  // Default to A4 if not specified

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
        
        // Create individual filter for each oscillator
        const filter = createFilter(def.filter);
        if (filter) {
            gain.connect(filter);
            filter.connect(envelope);
        } else {
            gain.connect(envelope);
        }

        // Schedule the glide after start if needed
        if (portamento > 0 && startFreq !== targetFreq) {
            osc.frequency.exponentialRampToValueAtTime(targetFreq, now + portamento);
        }

        return { osc, gain, filter };
    });

    // Noise
    const noise = new Tone.Noise('white');
    noise.volume.value = noiseLevel;
    if (noiseLevel > -60) {
        noise.connect(envelope);
    }

    // Start and trigger
    oscillators.forEach(({ osc }) => osc.start(now));
    envelope.triggerAttackRelease(duration, now);

    if (noiseLevel > -60) {
        noise.start(now);
        noise.stop(now + Tone.Time(duration).toSeconds());
    }

    // Stop oscillators after duration
    const stopAt = now + Tone.Time(duration).toSeconds() + 0.01;
    oscillators.forEach(({ osc }) => osc.stop(stopAt));

    // Cleanup
    setTimeout(() => {
        oscillators.forEach(({ osc, filter }) => {
            osc.dispose();
            if (filter) filter.dispose();
        });
        if (noiseLevel > -60) noise.dispose();
        envelope.dispose();
        master.dispose(); // Add master to cleanup
    }, Tone.Time(duration).toMilliseconds() + 50);
};

export default PlayPatch;