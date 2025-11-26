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

  // Fetch search results and follow status
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
        
        // Fetch follow status for each user
        const followPromises = results.map(user => 
          API.get(`/users/${user.username}/check_follow/`)
            .then(response => ({
              userId: user.id,
              isFollowing: response.data.is_following
            }))
            .catch(error => {
              console.error(`Failed to check follow status for ${user.username}:`, error);
              return {
                userId: user.id,
                isFollowing: false
              };
            })
        );

        Promise.all(followPromises).then(followResults => {
          const initialFollowingState = {};
          followResults.forEach(result => {
            initialFollowingState[result.userId] = result.isFollowing;
          });
          setFollowingMap(initialFollowingState);
        });
      })
      .catch((err) => {
        console.error('User search failed:', err);
        setData({ results: [], count: 0, next: null, previous: null });
      })
      .finally(() => setLoading(false));
  }, [query, page, pageSize]);

  // Follow/Unfollow function
  const handleFollowToggle = async (userId, username, currentlyFollowing) => {
    setLoadingFollow(prev => ({ ...prev, [userId]: true }));
    
    try {
      if (currentlyFollowing) {
        // Unfollow
        await API.delete(`/users/${username}/unfollow/`);
      } else {
        // Follow
        await API.post(`/users/${username}/follow/`);
      }
      
      // Update local state
      setFollowingMap(prev => ({
        ...prev,
        [userId]: !currentlyFollowing
      }));
    } catch (error) {
      console.error('Follow toggle failed:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.detail || 'Failed to update follow status';
      alert(`Error: ${errorMessage}`);
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
              alignItems: 'center',
              position: 'relative',
              minHeight: '60px'
            }}>
              <div style={{ flex: 1 }}>
                 <Link to={`/profile/${user.username}`} style={{ textDecoration: 'none', fontWeight: 'bold' }}>
                  {user.username}
                </Link>
                {user.display_name && (
                  <div style={{ color: '#666', fontSize: '0.9em' }}>
                    {user.display_name}
                  </div>
                )}
              </div>
              
              {/* Follow/Unfollow Button - Using CSS classes */}
              <div style={{ 
                position: 'relative',
                width: '100px',
                height: '36px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center'
              }}>
                <button
                  onClick={() => handleFollowToggle(user.id, user.username, followingMap[user.id])}
                  disabled={loadingFollow[user.id]}
                  className={followingMap[user.id] ? "btn btn-unfollow" : "btn btn-follow"}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {loadingFollow[user.id] ? '...' : followingMap[user.id] ? 'Unfollow' : 'Follow'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination - Using CSS classes */}
      {data.results.length > 0 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20, justifyContent: 'center' }}>
          <button 
            disabled={page <= 1} 
            onClick={() => goPage(page - 1)}
            className={page <= 1 ? "btn" : "btn btn-primary"}
          >
            Previous
          </button>
          <span>Page {page} of {totalPages}</span>
          <button 
            disabled={page >= totalPages} 
            onClick={() => goPage(page + 1)}
            className={page >= totalPages ? "btn" : "btn btn-primary"}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default SearchResults;