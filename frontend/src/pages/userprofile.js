import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import API from '../api';
import PlayPatch from '../components/PlayPatch';

const UserProfile = ({ isSelfProfile = false }) => {
    const { username } = useParams();
    const [user, setUser] = useState(null);
    const [patches, setPatches] = useState([]);
    const [isFollowing, setIsFollowing] = useState(false);
    const [currentUserId, setCurrentUserId] = useState(null);

    const checkFollowStatus = useCallback((targetId, currentId) => {
        if (!targetId || !currentId) return;

        API.get('/follows/')
            .then(res => {
                const following = res.data.some(
                    f => f.follower === currentId && f.following === targetId
                );
                setIsFollowing(following);
            })
            .catch(err => console.error('Error checking follow status', err));
    }, []);

    useEffect(() => {
        const token = localStorage.getItem('access_token');
        if (!token) return;

        try {
            const decoded = jwtDecode(token);
            setCurrentUserId(decoded.user_id);

            const targetUsername = username || decoded.username;

            API.get(`/users/${targetUsername}/`)
                .then(res => {
                    setUser(res.data);
                    const targetId = res.data.id;

                    API.get(`/patches/?uploaded_by=${targetId}`)
                        .then(res => setPatches(res.data))
                        .catch(err => {
                            console.error('Could not fetch patches', err);
                            setPatches([]);
                        });

                    checkFollowStatus(targetId, decoded.user_id);
                })
                .catch(err => {
                    console.error('User not found', err);
                    setUser(null);
                });

        } catch (err) {
            console.error('Token decoding failed:', err);
        }
    }, [username, checkFollowStatus]);

    const handleFollow = async () => {
        try {
            await API.post('/follows/', { following: user.id });
            checkFollowStatus(user.id, currentUserId);
        } catch (err) {
            console.error('Failed to follow:', err.response?.data || err);
        }
    };

    const handleUnfollow = async () => {
        try {
            await API.post('/follows/unfollow/', { following: user.id });
            checkFollowStatus(user.id, currentUserId);
        } catch (err) {
            console.error('Failed to unfollow:', err.response?.data || err);
        }
    };

    if (!user) return <p>Loading user...</p>;

    return (
        <div style={{ padding: '20px' }}>
            <h2>Profile: {user.username}</h2>
            <p>User ID: {user.id}</p>

            {currentUserId !== user.id && (
                isFollowing ? (
                    <button onClick={handleUnfollow}>Unfollow</button>
                ) : (
                    <button onClick={handleFollow}>Follow</button>
                )
            )}

            <h3>Posted Patches</h3>
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
                            <button
                                style={{ marginLeft: '10px' }}
                                onClick={() => PlayPatch(patch)}
                            >
                                Play
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p>This user has not posted any patches yet.</p>
            )}
        </div>
    );
};

export default UserProfile;
