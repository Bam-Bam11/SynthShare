import * as Tone from 'tone';

const PlayPatch = async (patch) => {
    await Tone.start();

    const params = patch.parameters || {};
    const note = patch.note || 'C4';
    const duration = patch.duration || '8n';

    const env = params.envelope || {};
    const filterParams = params.filter || {};
    const portamento = params.portamento ?? 0;
    const noiseLevel = params.noiseLevel ?? -60;

    // Envelope & Filter setup
    const envelope = new Tone.AmplitudeEnvelope({
        attack: env.attack ?? 0.1,
        decay: env.decay ?? 0.2,
        sustain: env.sustain ?? 0.7,
        release: env.release ?? 0.5,
    });

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

    // Oscillators — new multi-oscillator format
    const oscDefs = params.oscillators || [
        {
            type: params.oscillator || 'sine',
            frequency: Tone.Frequency(note).toFrequency(),
            gain: 1,
            detune: params.detune ?? 0
        }
    ];

    const oscillators = oscDefs.map(def => {
        const osc = new Tone.Oscillator({
            type: def.type,
            frequency: def.frequency || Tone.Frequency(note).toFrequency(),
            detune: def.detune || 0
        });

        const gain = new Tone.Gain(def.gain ?? 1);
        osc.connect(gain);

        if (filter) {
            gain.connect(filter);
        } else {
            gain.connect(envelope);
        }

        return { osc, gain };
    });

    // Noise (if used)
    const noise = new Tone.Noise('white');
    noise.volume.value = noiseLevel;

    if (noiseLevel > -60) {
        if (filter) {
            noise.connect(filter);
        } else {
            noise.connect(envelope);
        }
    }

    // Start oscillators
    oscillators.forEach(({ osc }) => osc.start());

    // Trigger envelope
    envelope.triggerAttackRelease(duration);

    if (noiseLevel > -60) {
        noise.start();
        setTimeout(() => noise.stop(), Tone.Time(duration).toMilliseconds());
    }

    // Stop oscillators after duration
    setTimeout(() => {
        oscillators.forEach(({ osc }) => osc.stop());
    }, Tone.Time(duration).toMilliseconds() + 10);
};

export default PlayPatch;
