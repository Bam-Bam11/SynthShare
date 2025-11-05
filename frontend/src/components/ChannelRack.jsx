// src/components/ChannelRack.js
import React, { useRef, useEffect, useState } from 'react';
import { useChannelRack } from '../context/ChannelRackContext';
import * as Tone from 'tone';
import PlayPatch from './PlayPatch';

const ChannelRack = () => {
  const {
    channels,
    tempo,
    setTempo,
    addChannel,
    removeChannel,
    toggleStep,
    isVisible,
    toggleVisibility,
    updateChannelLabel,
  } = useChannelRack();

  const stepIndexRef = useRef(0);
  const loopRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);

  const playSequence = async () => {
    await Tone.start();
    const transport = Tone.getTransport();

    if (loopRef.current) {
      transport.stop();
      loopRef.current.dispose();
      loopRef.current = null;
      stepIndexRef.current = 0;
      setIsPlaying(false);
      setCurrentStep(-1);
      return;
    }

    loopRef.current = new Tone.Loop((time) => {
      const step = stepIndexRef.current;
      setCurrentStep(step);

      channels.forEach((channel) => {
        if (channel.steps[step] && channel.patch) {
          PlayPatch(channel.patch, time);
        }
      });

      stepIndexRef.current = (step + 1) % 16;
    }, '16n');

    transport.bpm.value = tempo;
    transport.start();
    loopRef.current.start(0);
    setIsPlaying(true);
  };

  useEffect(() => {
    return () => {
      if (loopRef.current) {
        loopRef.current.dispose();
        loopRef.current = null;
      }
      Tone.getTransport().stop();
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        width: '420px',
        maxHeight: '70vh',
        overflowY: 'auto',
        background: '#fff',
        border: '1px solid #aaa',
        padding: '10px',
        boxShadow: '0 0 10px rgba(0,0,0,0.5)',
        zIndex: 1000,
        borderRadius: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>Channel Rack</h3>
        <button onClick={toggleVisibility}>Close</button>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>Tempo: {tempo} BPM</label>
        <input
          type="range"
          min="60"
          max="200"
          value={tempo}
          onChange={(e) => setTempo(parseInt(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <button onClick={playSequence} style={{ marginBottom: '10px' }}>
        {isPlaying ? 'Stop' : 'Play'}
      </button>

      {channels.map((channel, index) => {
        // Default label = position-based
        const defaultLabel = `Channel ${index + 1}`;
        // If user has typed a custom label on the patch, prefer that
        const userLabel =
          channel?.patch?.displayName && channel.patch.displayName.trim().length > 0
            ? channel.patch.displayName
            : null;
        const visibleLabel = userLabel || defaultLabel;

        return (
          <div key={channel.id} style={{ marginBottom: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {channel.patch ? (
                <input
                  type="text"
                  value={channel.patch.displayName || ''}
                  onChange={(e) => updateChannelLabel(channel.id, e.target.value)}
                  placeholder={defaultLabel}
                  style={{ width: '150px', marginRight: '10px' }}
                  title={channel.patch.name || defaultLabel}
                />
              ) : (
                <strong>{visibleLabel}</strong>
              )}
              <button onClick={() => removeChannel(channel.id)}>Remove</button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(16, 1fr)',
                gap: '4px',
                marginTop: '8px',
              }}
            >
              {channel.steps.map((active, stepIdx) => (
                <div
                  key={stepIdx}
                  onClick={() => toggleStep(channel.id, stepIdx)}
                  style={{
                    width: '100%',
                    paddingTop: '100%',
                    position: 'relative',
                    backgroundColor:
                      currentStep === stepIdx ? '#ffa500' : active ? '#4caf50' : '#ddd',
                    cursor: 'pointer',
                    borderRadius: '4px',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <button onClick={addChannel}>Add Channel</button>
    </div>
  );
};

export default ChannelRack;
