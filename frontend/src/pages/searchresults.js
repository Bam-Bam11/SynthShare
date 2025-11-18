import React, { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import API from '../api';

function useQueryParam(name) {
  const { search } = useLocation();
  return new URLSearchParams(search).get(name) || '';
}

const DEFAULT_PAGE_SIZE = 12;

const SearchResults = () => {
  const query = useQueryParam('query');
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page') || 1);
  const pageSize = Number(searchParams.get('page_size') || DEFAULT_PAGE_SIZE);

  const [data, setData] = useState({ results: [], count: 0, next: null, previous: null });
  const [loading, setLoading] = useState(false);
  const [followingMap, setFollowingMap] = useState({});
  const [loadingFollow, setLoadingFollow] = useState({});

  // Fetch search results
  useEffect(() => {
    if (!query.trim()) {
      setData({ results: [], count: 0, next: null, previous: null });
      return;
    }
    setLoading(true);
    API.get(`/users/?search=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`)
      .then((res) => {
        const payload = res.data;
        const results = Array.isArray(payload) ? payload : (payload.results || []);
        const count = Array.isArray(payload) ? payload.length : (payload.count ?? results.length);
        setData({ results, count, next: payload.next ?? null, previous: payload.previous ?? null });
        
        // Initialize following state for each user
        const initialFollowingState = {};
        results.forEach(user => {
          initialFollowingState[user.id] = user.is_following || false;
        });
        setFollowingMap(initialFollowingState);
      })
      .catch((err) => {
        console.error('User search failed:', err);
        setData({ results: [], count: 0, next: null, previous: null });
      })
      .finally(() => setLoading(false));
  }, [query, page, pageSize]);

  // Follow/Unfollow function
  const handleFollowToggle = async (userId, currentlyFollowing) => {
    setLoadingFollow(prev => ({ ...prev, [userId]: true }));
    
    try {
      if (currentlyFollowing) {
        // Unfollow
        await API.delete(`/users/${userId}/follow/`);
      } else {
        // Follow
        await API.post(`/users/${userId}/follow/`);
      }
      
      // Update local state
      setFollowingMap(prev => ({
        ...prev,
        [userId]: !currentlyFollowing
      }));
    } catch (error) {
      console.error('Follow toggle failed:', error);
      alert('Failed to update follow status');
    } finally {
      setLoadingFollow(prev => ({ ...prev, [userId]: false }));
    }
  };

  const goPage = (p) => setSearchParams({ query, page: String(p), page_size: String(pageSize) });
  const totalPages = Math.max(1, Math.ceil((data.count || 0) / pageSize));

  return (
    <div style={{ padding: '20px' }}>
      <h2>Search Results for: "{query}"</h2>
      {loading ? (
        <p>Searching…</p>
      ) : data.results.length === 0 ? (
        <p>No users found.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {data.results.map((user) => (
            <li key={user.id} style={{ 
              marginBottom: 16, 
              padding: 12, 
              border: '1px solid #ddd', 
              borderRadius: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                 <Link to={`/profile/${user.username}`} style={{ textDecoration: 'none', fontWeight: 'bold' }}>
                  {user.username}
                </Link>
                {user.display_name && (
                  <div style={{ color: '#666', fontSize: '0.9em' }}>
                    {user.display_name}
                  </div>
                )}
              </div>
              
              {/* Follow/Unfollow Button */}
              <button
                onClick={() => handleFollowToggle(user.id, followingMap[user.id])}
                disabled={loadingFollow[user.id]}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  background: followingMap[user.id] ? '#e0e0e0' : '#007bff',
                  color: followingMap[user.id] ? '#333' : 'white',
                  cursor: loadingFollow[user.id] ? 'not-allowed' : 'pointer',
                  opacity: loadingFollow[user.id] ? 0.6 : 1
                }}
              >
                {loadingFollow[user.id] ? '...' : followingMap[user.id] ? 'Unfollow' : 'Follow'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {data.results.length > 0 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20, justifyContent: 'center' }}>
          <button 
            disabled={page <= 1} 
            onClick={() => goPage(page - 1)}
            style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: 4 }}
          >
            Previous
          </button>
          <span>Page {page} of {totalPages}</span>
          <button 
            disabled={page >= totalPages} 
            onClick={() => goPage(page + 1)}
            style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: 4 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default SearchResults;