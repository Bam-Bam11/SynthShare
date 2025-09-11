import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import API from '../api';

const FollowersList = () => {
  const { username } = useParams();
  const [users, setUsers] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        const { data } = await API.get(`/users/username/${username}/followers/`);
        setUsers(data.users || []);
        setCount(data.count || 0);
      } catch (e) {
        console.error('Failed to load followers:', e);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [username]);

  if (loading) return <p>Loading followers…</p>;

  return (
    <div style={{ padding: '20px' }}>
      <h2>Followers of {username} ({count})</h2>
      {users.length === 0 ? (
        <p>No followers yet.</p>
      ) : (
        <ul>
          {users.map(u => (
            <li key={u.id}>
              <Link to={`/profile/${u.username}`}>{u.username}</Link>
            </li>
          ))}
        </ul>
      )}
      <p style={{ marginTop: 16 }}>
        <Link to={`/profile/${username}`}>← Back to profile</Link>
      </p>
    </div>
  );
};

export default FollowersList;
