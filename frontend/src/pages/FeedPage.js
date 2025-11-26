// src/pages/FeedPage.jsx
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as Tone from 'tone';
import API from '../api';
import PlayPatch from '../components/PlayPatch';
import { useChannelRack } from '../context/ChannelRackContext';

const PAGE_SIZE = 20;

const FeedPage = () => {
  const [loading, setLoading] = useState(false);

  // Patches feed
  const [patches, setPatches] = useState([]);
  const [patchError, setPatchError] = useState(null);

  // Tracks feed (optional)
  const [tracks, setTracks] = useState([]);
  const [trackError, setTrackError] = useState(null);

  const { assignPatchToFirstEmptyChannel } = useChannelRack();

  // --- Discrete track preview state ---
  const [previewingId, setPreviewingId] = useState(null);
  const previewTimersRef = useRef([]);

  const clearPreviewTimers = () => {
    previewTimersRef.current.forEach(clearTimeout);
    previewTimersRef.current = [];
  };

  useEffect(() => {
    const fetchFeed = async () => {
      setLoading(true);
      setPatchError(null);
      setTrackError(null);
      try {
        // ---- patches feed ----
        const p = await API.get(`/feed/?page=1&page_size=${PAGE_SIZE}`);
        const pdata = p?.data;
        const plist = Array.isArray(pdata?.results)
          ? pdata.results
          : Array.isArray(pdata)
          ? pdata
          : [];
        setPatches(plist);
      } catch (err) {
        setPatchError(err?.response?.data || err?.message || 'Failed to load patch feed');
        setPatches([]);
      }

      try {
        // ---- tracks feed - use the new tracks-feed endpoint ----
        const t = await API.get(`/tracks-feed/?page=1&page_size=${PAGE_SIZE}`); // CHANGED THIS LINE
        const tdata = t?.data;
        const tlist = Array.isArray(tdata?.results)
          ? tdata.results
          : Array.isArray(tdata)
          ? tdata
          : [];
        setTracks(tlist);
      } catch (err) {
        console.error('Failed to load tracks:', err);
        setTrackError(err?.response?.data || err?.message || 'Failed to load tracks');
        setTracks([]);
      } finally {
        setLoading(false);
      }
    };

    fetchFeed();

    // cleanup any scheduled preview timers if user leaves the page
    return () => {
      clearPreviewTimers();
      try {
        Tone.getTransport().stop();
      } catch {}
    };
  }, []);

  // ---- Discrete track Play/Stop (no UI timeline) ----
  const handlePlayTrack = async (trackId) => {
    if (previewingId === trackId) {
      clearPreviewTimers();
      setPreviewingId(null);
      return;
    }

    clearPreviewTimers();
    setPreviewingId(trackId);

    try {
      await Tone.start();
      await Tone.getContext().resume();

      // Fetch full track with composition (new) or items (legacy)
      const { data } = await API.get(`/tracks/${trackId}/`);
      const bpm = Number(data.bpm) || 120;

      let rows = [];
      if (Array.isArray(data.composition) && data.composition.length) {
        rows = data.composition.map(r => ({
          patchId: Number(r.patch),
          startBeat: Math.max(0, Number(r.start_beat ?? 0)),
          endBeat: Math.max(0, Number(r.end_beat ?? 0)),
        }));
      } else if (Array.isArray(data.items) && data.items.length) {
        // legacy fallback
        rows = data.items.map(it => ({
          patchId: Number(it.patch?.id ?? it.patch ?? it.patch_id),
          startBeat: Math.max(0, Number(it.start_beat ?? 0)),
          endBeat: Math.max(0, Number(it.start_beat ?? 0) + Math.max(0.25, Number(it.length_beats ?? 1))),
        }));
      }

      if (!rows.length) {
        setPreviewingId(null);
        return;
      }

      // Fetch any missing patch details
      const uniqueIds = Array.from(new Set(rows.map(r => r.patchId).filter(Boolean)));
      const fetched = await Promise.allSettled(uniqueIds.map(id => API.get(`/patches/${id}/`)));
      const byId = new Map();
      fetched.forEach((res, idx) => {
        const id = uniqueIds[idx];
        if (res.status === 'fulfilled' && res.value) {
          byId.set(id, res.value);
        }
      });

      const playable = rows
        .map(({ patchId, startBeat, endBeat }) => {
          const patchObj = byId.get(patchId);
          if (!patchObj || !patchObj.parameters) return null;
          const lengthBeats = Math.max(0.25, endBeat - startBeat);
          return { patchObj, startBeat, lengthBeats };
        })
        .filter(Boolean);

      if (!playable.length) {
        setPreviewingId(null);
        return;
      }

      const beatToSec = (b) => (60 / bpm) * b;
      const base = Tone.now() + 0.12;
      let maxEndBeat = 0;

      for (const { patchObj, startBeat, lengthBeats } of playable) {
        const startSec = beatToSec(startBeat);
        const durSec = beatToSec(lengthBeats);

        const delayMs = Math.max(0, (base + startSec - Tone.now()) * 1000);
        const id = setTimeout(() => {
          PlayPatch({ ...patchObj, duration: durSec });
        }, delayMs);
        previewTimersRef.current.push(id);

        maxEndBeat = Math.max(maxEndBeat, startBeat + lengthBeats);
      }

      // Auto-stop after the last clip
      const stopMs = Math.max(0, (base + beatToSec(maxEndBeat) - Tone.now()) * 1000) + 60;
      const stopId = setTimeout(() => {
        clearPreviewTimers();
        setPreviewingId(null);
      }, stopMs);
      previewTimersRef.current.push(stopId);
    } catch (err) {
      console.error('Track preview failed:', err);
      clearPreviewTimers();
      setPreviewingId(null);
    }
  };

  return (
    <div className="p-5">
      <h2>Your Feed</h2>

      {loading && <p>Loading...</p>}

      {!loading && (
        <>
          {/* Patches */}
          {patchError && (
            <div className="text-red-600 text-sm mb-2">
              Error loading patches: {typeof patchError === 'string' ? patchError : JSON.stringify(patchError)}
            </div>
          )}

          <h3 className="mt-3">Patches</h3>
          {patches.length === 0 ? (
            <p>No posts from followed users yet.</p>
          ) : (
            <ul>
              {patches.map((patch) => (
                <li key={patch.id} className="mb-2">
                  <strong>
                    <Link
                      to={`/patches/${patch.id}`}
                      className="no-underline text-blue-600 dark:text-blue-400"
                    >
                      {patch.name}
                    </Link>
                  </strong>{' '}
                  by{' '}
                  <Link
                    to={`/profile/${patch.uploaded_by}`}
                    className="no-underline text-green-600 dark:text-green-400"
                  >
                    {patch.uploaded_by}
                  </Link>
                  <br />
                  Posted: {new Date(patch.created_at).toLocaleString()}
                  <span className="inline-flex flex-wrap gap-2 ml-2">
                    <button
                      className="btn btn-play"
                      onClick={() => PlayPatch(patch)}
                    >
                      Play
                    </button>
                    <button
                      className="btn btn-add"
                      onClick={() => assignPatchToFirstEmptyChannel(patch)}
                    >
                      Add to Rack
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Tracks */}
          {trackError && (
            <div className="text-red-600 text-sm mt-3">
              Error loading tracks: {typeof trackError === 'string' ? trackError : JSON.stringify(trackError)}
            </div>
          )}

          <h3 className="mt-4">Tracks</h3>
          {tracks.length === 0 ? (
            <p>No tracks from followed users yet.</p>
          ) : (
            <ul>
              {tracks.map((t) => (
                <li key={t.id} className="mb-2">
                  <strong>
                    <Link
                      to={`/tracks/${t.id}`}
                      className="no-underline text-blue-600 dark:text-blue-400"
                    >
                      {t.name || `Track ${t.id}`}
                    </Link>
                  </strong>{' '}
                  by{' '}
                  <Link
                    to={`/profile/${t.uploaded_by}`}
                    className="no-underline text-green-600 dark:text-green-400"
                  >
                    {t.uploaded_by}
                  </Link>
                  <br />
                  Posted: {new Date(t.created_at).toLocaleString()}
                  <span className="inline-flex flex-wrap gap-2 ml-2">
                    <button
                      className="btn btn-play"
                      onClick={() => handlePlayTrack(t.id)}
                    >
                      {previewingId === t.id ? 'Stop' : 'Play'}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default FeedPage;