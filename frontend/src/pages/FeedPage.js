import React, { useEffect, useState } from 'react';
import API from '../api';

const FeedPage = () => {
    const [patches, setPatches] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        console.log('FeedPage useEffect running'); // debug

        const fetchFeed = async () => {
            try {
                const res = await API.get('/feed/');
                console.log('Feed response:', res); // debug
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
                    {patches.map(patch => (
                        <li key={patch.id}>
                            <strong>{patch.name}</strong> by user ID {patch.uploaded_by}<br />
                            Posted: {new Date(patch.created_at).toLocaleString()}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default FeedPage;
