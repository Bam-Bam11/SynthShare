import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import API from '../api';
import PlayPatch from '../components/PlayPatch';
import { useChannelRack } from '../context/ChannelRackContext';
import { postPatch, savePatch, deletePatch, unpostPatch, downloadPatch } from '../utils/patchActions';

const PREVIEW_PAGE_SIZE = 6;

const UserProfile = ({ isSelfProfile: propIsSelfProfile = false }) => {
  const { username } = useParams();
  const [user, setUser] = useState(null);

  // posted preview + saved preview
  const [patches, setPatches] = useState([]);           // posted (preview)
  const [savedPatches, setSavedPatches] = useState([]); // saved (preview, only if self)

  // follow-related
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);

  const [currentUserId, setCurrentUserId] = useState(null);
  const [isSelfProfile, setIsSelfProfile] = useState(propIsSelfProfile);

  const { assignPatchToFirstEmptyChannel } = useChannelRack();

  // Helper to re-sync just the compact header (counts + is_following)
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
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      const decoded = jwtDecode(token);
      setCurrentUserId(decoded.user_id);

      const targetUsername = username || decoded.username; // prefer URL param

      // 1) Load target user (expects follower_count, following_count, is_following)
      API.get(`/users/username/${targetUsername}/`)
        .then(async (res) => {
          const u = res.data;
          setUser(u);

          setIsSelfProfile(decoded.user_id === u.id);

          // take counts/status directly from backend
          setFollowerCount(u.follower_count ?? 0);
          setFollowingCount(u.following_count ?? 0);
          setIsFollowing(!!u.is_following);

          // 2) Load posted preview via paginated endpoint
          const postedRes = await API.get(
            `/patches/posted-by/${targetUsername}/?page=1&page_size=${PREVIEW_PAGE_SIZE}`
          );
          setPatches(Array.isArray(postedRes.data.results) ? postedRes.data.results : []);

          // 3) Load saved preview if viewing own profile
          if (decoded.user_id === u.id) {
            try {
              const savedRes = await API.get(
                `/patches/saved-by/${targetUsername}/?page=1&page_size=${PREVIEW_PAGE_SIZE}`
              );
              setSavedPatches(Array.isArray(savedRes.data.results) ? savedRes.data.results : []);
            } catch (err) {
              // 403 when trying to view someone else's saved list
              if (err?.response?.status !== 403) {
                console.error('Failed to load saved preview:', err);
              }
              setSavedPatches([]);
            }
          } else {
            setSavedPatches([]);
          }
        })
        .catch(err => {
          console.error('Failed to load profile/patches:', err);
          setUser(null);
          setPatches([]);
          setSavedPatches([]);
        });
    } catch (err) {
      console.error('Token decoding failed:', err);
    }
  }, [username]);

  // Optimistic follow + re-sync header
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

  // Optimistic unfollow + re-sync header
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

  const handlePostPatch = async (patchId) => {
    try {
      await postPatch(patchId);
      setSavedPatches(prev =>
        prev.map(p => p.id === patchId ? { ...p, is_posted: true } : p)
      );
      setPatches(prev => {
        const already = prev.find(p => p.id === patchId);
        if (already) return prev;
        const justPosted = savedPatches.find(p => p.id === patchId);
        return justPosted ? [...prev, { ...justPosted, is_posted: true }] : prev;
      });
    } catch (err) {
      console.error('Failed to post patch:', err);
    }
  };

  const handleUnpostPatch = async (patchId) => {
    try {
      await unpostPatch(patchId);
      setPatches(prev => prev.filter(p => p.id !== patchId));
      setSavedPatches(prev =>
        prev.map(p => p.id === patchId ? { ...p, is_posted: false } : p)
      );
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

  if (!user) return <p>Loading user...</p>;

  return (
    <div style={{ padding: '20px' }}>
      <h2>Profile: {user.username}</h2>
      <p>User ID: {user.id}</p>

      {/* follower stats from backend */}
      <p style={{ marginTop: 6, color: '#555' }}>
        <Link to={`/profile/${user.username}/followers`} style={{ textDecoration: 'none' }}>
          Followers: <strong>{followerCount}</strong>
        </Link>
        &nbsp;|&nbsp;
        <Link to={`/profile/${user.username}/following`} style={{ textDecoration: 'none' }}>
          Following: <strong>{followingCount}</strong>
        </Link>
      </p>

      {!isSelfProfile && (
        isFollowing ? (
          <button onClick={handleUnfollow} disabled={followBusy}>Unfollow</button>
        ) : (
          <button onClick={handleFollow} disabled={followBusy}>Follow</button>
        )
      )}

      {/* Posted preview + View all link */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 20 }}>
        <h3 style={{ margin: 0 }}>Posted Patches</h3>
        <Link to={`/users/${user.username}/posted`}>View all posted</Link>
      </div>
      {patches.length > 0 ? (
        <ul>
          {patches.map(patch => (
            <li key={patch.id}>
              <strong>
                <Link to={`/patches/${patch.id}`} style={{ textDecoration: 'none', color: 'blue' }}>
                  {patch.name}
                </Link>
              </strong>{' '}
              ({new Date(patch.created_at).toLocaleString()})
              <button style={{ marginLeft: '10px' }} onClick={() => PlayPatch(patch)}>Play</button>
              <button style={{ marginLeft: '10px' }} onClick={() => assignPatchToFirstEmptyChannel(patch)}>Add to Rack</button>
              {isSelfProfile && (
                <>
                  <button style={{ marginLeft: '10px' }} onClick={() => handleUnpostPatch(patch.id)}>Unpost</button>
                  <button style={{ marginLeft: '10px' }} onClick={() => handleDeletePatch(patch.id)}>Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>This user has not posted any patches yet.</p>
      )}

      {/* Saved preview + View all link (only for self) */}
      {isSelfProfile && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 24 }}>
            <h3 style={{ margin: 0 }}>Saved Patches (All Created)</h3>
            <Link to={`/users/${user.username}/saved`}>View all saved</Link>
          </div>
          {savedPatches.length > 0 ? (
            <ul>
              {savedPatches.map(patch => (
                <li key={patch.id}>
                  <strong>
                    <Link to={`/patches/${patch.id}`} style={{ textDecoration: 'none', color: 'blue' }}>
                      {patch.name}
                    </Link>
                  </strong>{' '}
                  ({new Date(patch.created_at).toLocaleString()})
                  <button style={{ marginLeft: '10px' }} onClick={() => PlayPatch(patch)}>Play</button>
                  <button style={{ marginLeft: '10px' }} onClick={() => assignPatchToFirstEmptyChannel(patch)}>Add to Rack</button>
                  {!patch.is_posted && (
                    <button style={{ marginLeft: '10px' }} onClick={() => handlePostPatch(patch.id)}>Post</button>
                  )}
                  <button style={{ marginLeft: '10px' }} onClick={() => handleDeletePatch(patch.id)}>Delete</button>
                </li>
              ))}
            </ul>
          ) : (
            <p>You have not created any patches yet.</p>
          )}
        </>
      )}
    </div>
  );
};

export default UserProfile;
