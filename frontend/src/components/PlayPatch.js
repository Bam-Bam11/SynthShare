import * as Tone from 'tone';

const PlayPatch = async (patch) => {
    await Tone.start();

    const params = patch.parameters || {};
    const oscType = params.oscillator || 'sine';
    const detune = params.detune ?? 0;
    const env = params.envelope || {};
    const filterParams = params.filter || {};
    const portamento = params.portamento ?? 0;
    const noiseLevel = params.noiseLevel ?? -60;
    const note = patch.note || 'C4';
    const duration = patch.duration || '8n';

    let filter;

    if (filterParams.type && filterParams.type !== 'none') {
        let frequency = 1000;  // Default cutoff

        if (filterParams.type === 'bandpass') {
            const low = filterParams.bandLow ?? 300;
            const high = filterParams.bandHigh ?? 3000;
            frequency = (low + high) / 2;
        } else {
            frequency = filterParams.cutoff ?? 1000;
        }

        filter = new Tone.Filter({
            type: filterParams.type,
            frequency: frequency,
            Q: filterParams.resonance ?? 1,
        }).toDestination();
    }

    const synth = new Tone.Synth({
        oscillator: { type: oscType, detune: detune },
        envelope: {
            attack: env.attack ?? 0.1,
            decay: env.decay ?? 0.2,
            sustain: env.sustain ?? 0.7,
            release: env.release ?? 0.5,
        },
        portamento: portamento,
    });

    if (filter) {
        synth.connect(filter);
    } else {
        synth.toDestination();
    }

    const noise = new Tone.Noise('white');
    noise.volume.value = noiseLevel;

    if (filter) {
        noise.connect(filter);
    } else {
        noise.toDestination();
    }

    synth.triggerAttackRelease(note, duration);

    if (noiseLevel > -60) {
        noise.start();
        setTimeout(() => noise.stop(), Tone.Time(duration).toMilliseconds());
    }
};

export default PlayPatch;
