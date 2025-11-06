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

    // Toggle off if already looping
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
    <div className="channel-rack">
      <div className="channel-rack__header">
        <h3 className="channel-rack__title">Channel Rack</h3>
        <button onClick={toggleVisibility} className="btn btn-ghost">Close</button>
      </div>

      <div className="channel-rack__controls">
        <label className="block mb-1">Tempo: {tempo} BPM</label>
        <input
          type="range"
          min="60"
          max="200"
          value={tempo}
          onChange={(e) => setTempo(parseInt(e.target.value, 10))}
        />
      </div>

      <button
        onClick={playSequence}
        className={isPlaying ? 'btn btn-stop mb-2' : 'btn btn-play mb-2'}
      >
        {isPlaying ? 'Stop' : 'Play'}
      </button>

      {channels.map((channel, index) => {
        const defaultLabel = `Channel ${index + 1}`;
        const userLabel =
          channel?.patch?.displayName && channel.patch.displayName.trim().length > 0
            ? channel.patch.displayName
            : null;
        const visibleLabel = userLabel || defaultLabel;

        return (
          <div key={channel.id} className="channel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {channel.patch ? (
                <input
                  type="text"
                  value={channel.patch.displayName || ''}
                  onChange={(e) => updateChannelLabel(channel.id, e.target.value)}
                  placeholder={defaultLabel}
                  className="channel-rack__label"
                  title={channel.patch.name || defaultLabel}
                />
              ) : (
                <strong>{visibleLabel}</strong>
              )}
              <button onClick={() => removeChannel(channel.id)} className="btn btn-danger">
                Remove
              </button>
            </div>

            <div className="step-grid">
              {channel.steps.map((active, stepIdx) => {
                const classes = [
                  'step',
                  active ? 'is-active' : '',
                  currentStep === stepIdx ? 'is-current' : '',
                ].join(' ').trim();

                return (
                  <div
                    key={stepIdx}
                    className={classes}
                    onClick={() => toggleStep(channel.id, stepIdx)}
                    title={`Step ${stepIdx + 1}`}
                  >
                    <div className="fill" />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <button onClick={addChannel} className="btn btn-add">Add Channel</button>
    </div>
  );
};

export default ChannelRack;
