import React, { useEffect, useState } from 'react';
import API from '../api';
import PlayPatch from '../components/PlayPatch';
import { Link } from 'react-router-dom';

const FeedPage = () => {
    const [patches, setPatches] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchFeed = async () => {
            try {
                const res = await API.get('/feed/');
                const sorted = res.data.sort(
                    (a, b) => new Date(b.created_at) - new Date(a.created_at)
                );
                setPatches(sorted);
            } catch (err) {
                console.error('Error loading feed:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchFeed();
    }, []);

    return (
        <div style={{ padding: '20px' }}>
            <h2>Your Feed</h2>
            {loading ? (
                <p>Loading...</p>
            ) : patches.length === 0 ? (
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
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default FeedPage;
