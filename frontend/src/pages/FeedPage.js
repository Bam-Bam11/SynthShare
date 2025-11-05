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
        // ---- tracks feed (if your backend provides it; ok if 404) ----
        const t = await API.get(`/tracks/feed/?page=1&page_size=${PAGE_SIZE}`);
        const tdata = t?.data;
        const tlist = Array.isArray(tdata?.results)
          ? tdata.results
          : Array.isArray(tdata)
          ? tdata
          : [];
        setTracks(tlist);
      } catch (err) {
        // Fail silently if endpoint doesn’t exist; still show patches
        if (err?.response?.status && err.response.status !== 404) {
          setTrackError(err?.response?.data || err?.message || 'Failed to load track feed');
        }
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

      // Fetch full track (with items) for accurate scheduling
      const { data } = await API.get(`/tracks/${trackId}/`);
      const items = Array.isArray(data.items) ? data.items : [];
      const bpm = Number(data.bpm) || 120;

      if (!items.length) {
        setPreviewingId(null);
        return;
      }

      const beatToSec = (b) => (60 / bpm) * b;
      const base = Tone.now() + 0.1;
      let maxEndBeat = 0;

      for (const it of items) {
        const startBeat = Math.max(0, Number(it.start_beat ?? 0));
        const lengthBeats = Math.max(0.25, Number(it.length_beats ?? 1));
        const params = it.patch_snapshot || it.patch?.parameters;
        if (!params) continue;

        const note = it.note || it.pitch || 'C4';
        const startSec = beatToSec(startBeat);
        const durSec = beatToSec(lengthBeats);

        const delayMs = Math.max(0, (base + startSec - Tone.now()) * 1000);
        const id = setTimeout(() => {
          PlayPatch({ parameters: params, note, duration: durSec });
        }, delayMs);
        previewTimersRef.current.push(id);

        maxEndBeat = Math.max(maxEndBeat, startBeat + lengthBeats);
      }

      // auto-stop after last clip
      const stopMs = Math.max(0, (base + beatToSec(maxEndBeat) - Tone.now()) * 1000) + 50;
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
    <div style={{ padding: '20px' }}>
      <h2>Your Feed</h2>

      {loading && <p>Loading...</p>}

      {!loading && (
        <>
          {/* Patches */}
          {patchError && (
            <div style={{ color: 'crimson', fontSize: 12, marginBottom: 8 }}>
              Error loading patches: {typeof patchError === 'string' ? patchError : JSON.stringify(patchError)}
            </div>
          )}

          <h3 style={{ marginTop: 12 }}>Patches</h3>
          {patches.length === 0 ? (
            <p>No posts from followed users yet.</p>
          ) : (
            <ul>
              {patches.map((patch) => (
                <li key={patch.id} style={{ marginBottom: '10px' }}>
                  <strong>
                    <Link
                      to={`/patches/${patch.id}`}
                      style={{ textDecoration: 'none', color: 'blue' }}
                    >
                      {patch.name}
                    </Link>
                  </strong>{' '}
                  by{' '}
                  <Link
                    to={`/profile/${patch.uploaded_by}`}
                    style={{ textDecoration: 'none', color: 'green' }}
                  >
                    {patch.uploaded_by}
                  </Link>
                  <br />
                  Posted: {new Date(patch.created_at).toLocaleString()}
                  <button
                    onClick={() => PlayPatch(patch)}
                    style={{ marginLeft: '10px' }}
                  >
                    Play
                  </button>
                  <button
                    onClick={() => assignPatchToFirstEmptyChannel(patch)}
                    style={{ marginLeft: '10px' }}
                  >
                    Add to Rack
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Tracks (shown if endpoint returns any) */}
          {trackError && (
            <div style={{ color: 'crimson', fontSize: 12, marginTop: 12 }}>
              Error loading tracks: {typeof trackError === 'string' ? trackError : JSON.stringify(trackError)}
            </div>
          )}

          {tracks.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Tracks</h3>
              <ul>
                {tracks.map((t) => (
                  <li key={t.id} style={{ marginBottom: '10px' }}>
                    <strong>
                      <Link
                        to={`/tracks/${t.id}`}
                        style={{ textDecoration: 'none', color: 'blue' }}
                      >
                        {t.name || `Track ${t.id}`}
                      </Link>
                    </strong>{' '}
                    by{' '}
                    <Link
                      to={`/profile/${t.uploaded_by}`}
                      style={{ textDecoration: 'none', color: 'green' }}
                    >
                      {t.uploaded_by}
                    </Link>
                    <br />
                    Posted: {new Date(t.created_at).toLocaleString()}
                    <button
                      onClick={() => handlePlayTrack(t.id)}
                      style={{ marginLeft: '10px' }}
                    >
                      {previewingId === t.id ? 'Stop' : 'Play'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default FeedPage;
