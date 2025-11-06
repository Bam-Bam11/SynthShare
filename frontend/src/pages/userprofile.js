// src/pages/userprofile.js
import React, { useEffect, useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import * as Tone from 'tone';
import API from '../api';
import PlayPatch from '../components/PlayPatch';
import { useChannelRack } from '../context/ChannelRackContext';
import { postPatch, savePatch, deletePatch, unpostPatch, downloadPatch } from '../utils/patchActions';

const PREVIEW_PAGE_SIZE = 6;

const takeList = (resp) => {
  const d = resp?.data;
  if (Array.isArray(d?.results)) return d.results;
  if (Array.isArray(d)) return d;
  return [];
};

const UserProfile = ({ isSelfProfile: propIsSelfProfile = false }) => {
  const { username } = useParams();
  const [user, setUser] = useState(null);

  // posted preview + saved preview (patches)
  const [patches, setPatches] = useState([]);           // posted (preview)
  const [savedPatches, setSavedPatches] = useState([]); // saved/unposted (self only)

  // posted preview + saved preview (tracks)
  const [postedTracks, setPostedTracks] = useState([]);
  const [savedTracks, setSavedTracks] = useState([]);   // saved/unposted (self only)

  // follow-related
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);

  const [currentUserId, setCurrentUserId] = useState(null);
  const [isSelfProfile, setIsSelfProfile] = useState(propIsSelfProfile);

  const { assignPatchToFirstEmptyChannel } = useChannelRack();

  // Discrete preview state
  const [previewingId, setPreviewingId] = useState(null);
  const previewTimersRef = useRef([]);
  const patchCacheRef = useRef(new Map()); // id -> full patch (from /patches/:id/)

  const clearPreviewTimers = () => {
    previewTimersRef.current.forEach(clearTimeout);
    previewTimersRef.current = [];
  };

  // Clean up any scheduled playback when unmounting or navigating away
  useEffect(() => {
    return () => {
      try {
        Tone.Transport.stop();
        Tone.Transport.cancel();
      } catch {}
      clearPreviewTimers();
    };
  }, []);

  // Helper to re-sync header (counts + is_following)
  const refreshHeader = async (uname) => {
    try {
      const { data } = await API.get(`/users/username/${uname}/`);
      setFollowerCount(data.follower_count ?? 0);
      setFollowingCount(data.following_count ?? 0);
      setIsFollowing(!!data.is_following);
    } catch (err) {
      console.error('Failed to refresh profile header:', err);
    }
  };

  useEffect(() => {
    // Decode token if present (do not block public profile view)
    const token = localStorage.getItem('access_token');
    let decoded = null;
    if (token) {
      try {
        decoded = jwtDecode(token);
        setCurrentUserId(decoded.user_id);
      } catch (e) {
        console.warn('Token decode failed:', e);
      }
    }

    const targetUsername = username;

    // Load profile owner basic info
    API.get(`/users/username/${targetUsername}/`)
      .then(async (res) => {
        const u = res.data;
        setUser(u);

        const viewingSelf = !!decoded && decoded.user_id === u.id;
        setIsSelfProfile(viewingSelf);

        // set counts/status from backend
        setFollowerCount(u.follower_count ?? 0);
        setFollowingCount(u.following_count ?? 0);
        setIsFollowing(!!u.is_following);

        // ----- PATCHES -----
        try {
          const postedRes = await API.get(
            `/patches/posted-by/${targetUsername}/?page=1&page_size=${PREVIEW_PAGE_SIZE}`
          );
          setPatches(takeList(postedRes));
        } catch (err) {
          console.error('Failed to load posted patches:', err);
          setPatches([]);
        }

        // Saved patches (self only)
        if (viewingSelf) {
          try {
            const savedRes = await API.get(
              `/patches/saved-by/${targetUsername}/?page=1&page_size=${PREVIEW_PAGE_SIZE}`
            );
            setSavedPatches(takeList(savedRes));
          } catch (err) {
            if (err?.response?.status !== 403) console.error('Failed to load saved patches:', err);
            setSavedPatches([]);
          }
        } else {
          setSavedPatches([]);
        }

        // ----- TRACKS -----
        try {
          // Use list endpoint with uploaded_by filter – backend will return posted-only for public,
          // and ALL (posted + unposted) when viewing own profile.
          const tRes = await API.get('/tracks/', {
            params: { uploaded_by: u.id, page: 1, page_size: PREVIEW_PAGE_SIZE }
          });
          const allTracks = takeList(tRes);

          if (viewingSelf) {
            setPostedTracks(allTracks.filter(t => t.is_posted));
            setSavedTracks(allTracks.filter(t => !t.is_posted));
          } else {
            setPostedTracks(allTracks); // already posted-only by backend
            setSavedTracks([]);         // hidden for others
          }
        } catch (err) {
          console.error('Failed to load tracks:', err);
          setPostedTracks([]); setSavedTracks([]);
        }
      })
      .catch(err => {
        console.error('Failed to load profile:', err);
        setUser(null);
        setPatches([]); setSavedPatches([]);
        setPostedTracks([]); setSavedTracks([]);
      });
  }, [username]);

  // Follow handlers
  const handleFollow = async () => {
    if (!user || followBusy) return;
    setFollowBusy(true);
    setIsFollowing(true);
    setFollowerCount(c => c + 1);
    try {
      await API.post('/follows/', { following: user.id });
      await refreshHeader(user.username);
    } catch (err) {
      console.error('Failed to follow:', err?.response?.data || err);
      setIsFollowing(false);
      setFollowerCount(c => Math.max(0, c - 1));
    } finally {
      setFollowBusy(false);
    }
  };

  const handleUnfollow = async () => {
    if (!user || followBusy) return;
    setFollowBusy(true);
    setIsFollowing(false);
    setFollowerCount(c => Math.max(0, c - 1));
    try {
      await API.post('/follows/unfollow/', { following: user.id });
      await refreshHeader(user.username);
    } catch (err) {
      console.error('Failed to unfollow:', err?.response?.data || err);
      setIsFollowing(true);
      setFollowerCount(c => c + 1);
    } finally {
      setFollowBusy(false);
    }
  };

  // ----- Patch handlers -----
  const handlePostPatch = async (patchId) => {
    try {
      await postPatch(patchId);
      const justPosted = savedPatches.find(p => p.id === patchId);
      if (justPosted) {
        setSavedPatches(prev => prev.filter(p => p.id !== patchId));
        setPatches(prev => [{ ...justPosted, is_posted: true }, ...prev]);
      } else {
        setPatches(prev => prev.map(p => p.id === patchId ? { ...p, is_posted: true } : p));
      }
    } catch (err) {
      console.error('Failed to post patch:', err);
    }
  };

  const handleUnpostPatch = async (patchId) => {
    try {
      await unpostPatch(patchId);
      const justUnposted = patches.find(p => p.id === patchId);
      setPatches(prev => prev.filter(p => p.id !== patchId));
      if (justUnposted) {
        setSavedPatches(prev => [{ ...justUnposted, is_posted: false }, ...prev]);
      }
    } catch (err) {
      console.error('Failed to unpost patch:', err);
    }
  };

  const handleDeletePatch = async (patchId) => {
    try {
      await deletePatch(patchId);
      setSavedPatches(prev => prev.filter(p => p.id !== patchId));
      setPatches(prev => prev.filter(p => p.id !== patchId));
    } catch (err) {
      console.error('Failed to delete patch:', err);
    }
  };

  // ----- Track handlers -----
  const postTrack = async (trackId) => API.post(`/tracks/${trackId}/post/`);
  const unpostTrack = async (trackId) => API.post(`/tracks/${trackId}/unpost/`);
  const deleteTrack = async (trackId) => API.delete(`/tracks/${trackId}/`);

  const handlePostTrack = async (trackId) => {
    try {
      await postTrack(trackId);
      const saved = savedTracks.find(t => t.id === trackId);
      if (saved) {
        setSavedTracks(prev => prev.filter(t => t.id !== trackId));
        setPostedTracks(prev => [{ ...saved, is_posted: true }, ...prev]);
      } else {
        setPostedTracks(prev => prev.map(t => t.id === trackId ? { ...t, is_posted: true } : t));
      }
    } catch (err) {
      console.error('Failed to post track:', err);
    }
  };

  const handleUnpostTrack = async (trackId) => {
    try {
      await unpostTrack(trackId);
      const justUnposted = postedTracks.find(t => t.id === trackId);
      setPostedTracks(prev => prev.filter(t => t.id !== trackId));
      if (justUnposted) {
        setSavedTracks(prev => [{ ...justUnposted, is_posted: false }, ...prev]);
      }
    } catch (err) {
      console.error('Failed to unpost track:', err);
    }
  };

  const handleDeleteTrack = async (trackId) => {
    try {
      await deleteTrack(trackId);
      setPostedTracks(prev => prev.filter(t => t.id !== trackId));
      setSavedTracks(prev => prev.filter(t => t.id !== trackId));
    } catch (err) {
      console.error('Failed to delete track:', err);
    }
  };

  // --- Helpers to build a full patch object for playback ---
  const resolvePatchFromId = async (maybeId) => {
    const id = typeof maybeId === 'number' || typeof maybeId === 'string'
      ? Number(maybeId)
      : (maybeId?.id ?? null);
    if (!id) return null;

    const cache = patchCacheRef.current;
    if (cache.has(id)) return cache.get(id);

    const { data } = await API.get(`/patches/${id}/`);
    cache.set(id, data);
    return data;
  };

  // ----- Track preview using composition (fallback to items for legacy) -----
  const handlePlayTrack = async (trackId) => {
    // Toggle behaviour: if already previewing this track, stop it
    if (previewingId === trackId) {
      clearPreviewTimers();
      setPreviewingId(null);
      return;
    }

    // Stop any other preview first
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

      // Fetch any missing patch details (cached)
      const uniqueIds = Array.from(new Set(rows.map(r => r.patchId).filter(Boolean)));
      const fetched = await Promise.allSettled(uniqueIds.map(id => resolvePatchFromId(id)));
      const byId = new Map();
      fetched.forEach((res, idx) => {
        const id = uniqueIds[idx];
        if (res.status === 'fulfilled' && res.value) byId.set(id, res.value);
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

      // Base start a touch in the future
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

  if (!user) return <p>Loading user...</p>;

  return (
    <div className="p-5">
      <h2>Profile: {user.username}</h2>
      <p>User ID: {user.id}</p>

      {/* follower stats from backend */}
      <p className="mt-1 text-gray-600 dark:text-gray-300">
        <Link to={`/profile/${user.username}/followers`} className="no-underline">
          Followers: <strong>{followerCount}</strong>
        </Link>
        &nbsp;|&nbsp;
        <Link to={`/profile/${user.username}/following`} className="no-underline">
          Following: <strong>{followingCount}</strong>
        </Link>
      </p>

      {!isSelfProfile && (
        isFollowing ? (
          <button className="btn btn-ghost" onClick={handleUnfollow} disabled={followBusy}>Unfollow</button>
        ) : (
          <button className="btn btn-primary" onClick={handleFollow} disabled={followBusy}>Follow</button>
        )
      )}

      {/* Posted Patches */}
      <div className="flex items-baseline gap-3 mt-5">
        <h3 className="m-0">Posted Patches</h3>
        <Link to={`/users/${user.username}/posted`}>View all posted</Link>
      </div>
      {patches.length > 0 ? (
        <ul>
          {patches.map(patch => (
            <li key={patch.id} className="mb-2">
              <strong>
                <Link to={`/patches/${patch.id}`} className="no-underline text-blue-600 dark:text-blue-400">
                  {patch.name}
                </Link>
              </strong>{' '}
              ({new Date(patch.created_at).toLocaleString()})
              <span className="inline-flex flex-wrap gap-2 ml-2">
                <button className="btn btn-play" onClick={() => PlayPatch(patch)}>Play</button>
                <button className="btn btn-add" onClick={() => assignPatchToFirstEmptyChannel(patch)}>Add to Rack</button>
                {isSelfProfile && (
                  <>
                    <button className="btn btn-unpost" onClick={() => handleUnpostPatch(patch.id)}>Unpost</button>
                    <button className="btn btn-danger" onClick={() => handleDeletePatch(patch.id)}>Delete</button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>This user has not posted any patches yet.</p>
      )}

      {/* Saved Patches (self only) */}
      {isSelfProfile && (
        <>
          <div className="flex items-baseline gap-3 mt-6">
            <h3 className="m-0">Saved Patches</h3>
            <Link to={`/users/${user.username}/saved`}>View all saved</Link>
          </div>
          {savedPatches.length > 0 ? (
            <ul>
              {savedPatches.map(patch => (
                <li key={patch.id} className="mb-2">
                  <strong>
                    <Link to={`/patches/${patch.id}`} className="no-underline text-blue-600 dark:text-blue-400">
                      {patch.name}
                    </Link>
                  </strong>{' '}
                  ({new Date(patch.created_at).toLocaleString()})
                  <span className="inline-flex flex-wrap gap-2 ml-2">
                    <button className="btn btn-play" onClick={() => PlayPatch(patch)}>Play</button>
                    <button className="btn btn-add" onClick={() => assignPatchToFirstEmptyChannel(patch)}>Add to Rack</button>
                    {!patch.is_posted && (
                      <button className="btn btn-post" onClick={() => handlePostPatch(patch.id)}>Post</button>
                    )}
                    <button className="btn btn-danger" onClick={() => handleDeletePatch(patch.id)}>Delete</button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>You have not created any unposted patches yet.</p>
          )}
        </>
      )}

      {/* Posted Tracks */}
      <div className="flex items-baseline gap-3 mt-7">
        <h3 className="m-0">Posted Tracks</h3>
      </div>
      {postedTracks.length > 0 ? (
        <ul>
          {postedTracks.map(t => (
            <li key={t.id} className="mb-2">
              <strong>
                <Link to={`/tracks/${t.id}`} className="no-underline text-blue-600 dark:text-blue-400">
                  {t.name || `Track ${t.id}`}
                </Link>
              </strong>{' '}
              ({new Date(t.created_at).toLocaleString()})
              <span className="inline-flex flex-wrap gap-2 ml-2">
                <button className="btn btn-play" onClick={() => handlePlayTrack(t.id)}>
                  {previewingId === t.id ? 'Stop' : 'Play'}
                </button>
                {isSelfProfile && (
                  <>
                    <button className="btn btn-unpost" onClick={() => handleUnpostTrack(t.id)}>Unpost</button>
                    <button className="btn btn-danger" onClick={() => handleDeleteTrack(t.id)}>Delete</button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>This user has not posted any tracks yet.</p>
      )}

      {/* Saved Tracks (self only) */}
      {isSelfProfile && (
        <>
          <div className="flex items-baseline gap-3 mt-6">
            <h3 className="m-0">Saved Tracks</h3>
          </div>
          {savedTracks.length > 0 ? (
            <ul>
              {savedTracks.map(t => (
                <li key={t.id} className="mb-2">
                  <strong>
                    <Link to={`/tracks/${t.id}`} className="no-underline text-blue-600 dark:text-blue-400">
                      {t.name || `Track ${t.id}`}
                    </Link>
                  </strong>{' '}
                  ({new Date(t.created_at).toLocaleString()})
                  <span className="inline-flex flex-wrap gap-2 ml-2">
                    <button className="btn btn-play" onClick={() => handlePlayTrack(t.id)}>
                      {previewingId === t.id ? 'Stop' : 'Play'}
                    </button>
                    {t.uploaded_by_id === currentUserId && !t.is_posted && (
                      <button className="btn btn-post" onClick={() => handlePostTrack(t.id)}>Post</button>
                    )}
                    {t.uploaded_by_id === currentUserId && (
                      <button className="btn btn-danger" onClick={() => handleDeleteTrack(t.id)}>Delete</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>You have not created any unposted tracks yet.</p>
          )}
        </>
      )}
    </div>
  );
};

export default UserProfile;
