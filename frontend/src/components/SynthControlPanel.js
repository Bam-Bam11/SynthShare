import React from 'react';

// Helper component for a single knob
const SynthKnob = ({ label, min, max, step, value, onChange }) => {
    return (
        <div style={{ textAlign: 'center', margin: '10px' }}>
            <webaudio-knob
                value={value}
                min={min}
                max={max}
                step={step}
                diameter="64"
                tooltip={label}
                src="https://webaudiodemos.appspot.com/lib/Knob3.png"
                onInput={(e) => onChange(parseFloat(e.target.value))}
            />
            <div style={{ fontSize: '14px', marginTop: '5px' }}>{label}</div>
        </div>
    );
};

// Main control panel
const SynthControlPanel = ({ params, setParams }) => {
    return (
        <div
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                backgroundColor: '#111',
                padding: '20px',
                borderRadius: '10px',
                gap: '20px',
            }}
        >
            <SynthKnob
                label="Cutoff"
                min={100}
                max={10000}
                step={10}
                value={params.filterCutoff || 4000}
                onChange={(val) => setParams(prev => ({ ...prev, filterCutoff: val }))}
            />
            <SynthKnob
                label="Resonance"
                min={0}
                max={10}
                step={0.1}
                value={params.resonance || 1}
                onChange={(val) => setParams(prev => ({ ...prev, resonance: val }))}
            />
            <SynthKnob
                label="Attack"
                min={0}
                max={2}
                step={0.01}
                value={params.attack || 0.1}
                onChange={(val) => setParams(prev => ({ ...prev, attack: val }))}
            />
            <SynthKnob
                label="Decay"
                min={0}
                max={2}
                step={0.01}
                value={params.decay || 0.2}
                onChange={(val) => setParams(prev => ({ ...prev, decay: val }))}
            />
            <SynthKnob
                label="Release"
                min={0}
                max={4}
                step={0.01}
                value={params.release || 0.5}
                onChange={(val) => setParams(prev => ({ ...prev, release: val }))}
            />
        </div>
    );
};

export default SynthControlPanel;
