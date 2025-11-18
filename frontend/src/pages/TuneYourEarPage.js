import React, { useState } from 'react';
import API from '../api';
import PlayPatch from '../components/PlayPatch';
import SynthInterface from '../components/SynthInterface';
import { calculateSimilarityScore, getSimilarityBreakdown } from '../utils/similarity';

const TuneYourEarPage = () => {
  const [targetPatch, setTargetPatch] = useState(null);
  const [currentParams, setCurrentParams] = useState({});
  const [score, setScore] = useState(null);

  const loadRandomPatch = async () => {
    try {
      const res = await API.get('/patches/random/');
      const patch =
        (res.data && res.data.id) ? res.data :
        (res.data?.results?.[0]?.id ? res.data.results[0] :
        (res.data?.patch?.id ? res.data.patch : res.data));
      setTargetPatch(patch);
      setScore(null);
    } catch {
      // Optionally surface a user-friendly toast here
    }
  };

  const handleSubmit = () => {
    if (!targetPatch) return;
    const breakdown = getSimilarityBreakdown(currentParams, targetPatch.parameters);
    const simScore = calculateSimilarityScore(currentParams, targetPatch.parameters);
    setScore(simScore);
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Tune Your Ear</h2>

      <button onClick={loadRandomPatch}>Load Random Synth</button>{' '}
      <button onClick={() => targetPatch && PlayPatch(targetPatch)}>Play Target</button>{' '}
      <button onClick={handleSubmit}>Submit</button>

      {score !== null && (
        <p>
          <strong>Similarity Score:</strong> {score.toFixed(1)} / 100
        </p>
      )}

      <hr />

      <SynthInterface
        onParamsChange={setCurrentParams}
        initialParams={null}
        hideNameAndDescription={true}
      />
    </div>
  );
};

export default TuneYourEarPage;
