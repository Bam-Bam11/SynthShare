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
      })
      .catch((err) => {
        console.error('User search failed:', err);
        setData({ results: [], count: 0, next: null, previous: null });
      })
      .finally(() => setLoading(false));
  }, [query, page, pageSize]);

  const goPage = (p) => setSearchParams({ query, page: String(p), page_size: String(pageSize) });
  const totalPages = Math.max(1, Math.ceil((data.count || 0) / pageSize));

  return (
    <div style={{ padding: '20px' }}>
      <h2>Search: {query}</h2>
      {loading ? (
        <p>Searching…</p>
      ) : data.results.length === 0 ? (
        <p>No users found.</p>
      ) : (
        <ul>
          {data.results.map((u) => (
            <li key={u.id} style={{ marginBottom: 8 }}>
              <Link to={`/users/${u.username}`}>{u.username}</Link>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
        <button disabled={page <= 1} onClick={() => goPage(page - 1)}>Prev</button>
        <span>Page {page} of {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => goPage(page + 1)}>Next</button>
      </div>
    </div>
  );
};

export default SearchResults;

