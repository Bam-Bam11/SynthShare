import React, { useState } from 'react';
import * as Tone from 'tone';

function SynthComponent() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [waveform, setWaveform] = useState('sine');

    const synth = new Tone.Synth({
        oscillator: { type: waveform }
    }).toDestination();

    const handlePlay = async () => {
        await Tone.start(); // required on user gesture in modern browsers
        synth.triggerAttackRelease("C4", "8n");
        setIsPlaying(true);
    };

    const handleWaveformChange = (e) => {
        setWaveform(e.target.value);
    };

    return (
        <div style={{ marginTop: '20px' }}>
            <h2>Basic Synth</h2>
            <select value={waveform} onChange={handleWaveformChange}>
                <option value="sine">Sine</option>
                <option value="square">Square</option>
                <option value="triangle">Triangle</option>
                <option value="sawtooth">Sawtooth</option>
            </select>
            <button onClick={handlePlay} style={{ marginLeft: '10px' }}>
                Play Note
            </button>
        </div>
    );
}

export default SynthComponent;
