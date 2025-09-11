import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate, useLocation, Link } from "react-router-dom";
import API from "../api";

export default function UserSavedPatches() {
  const { username } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState({ results: [], count: 0, next: null, previous: null });
  const [error, setError] = useState(null);

  const page = Number(searchParams.get("page") || 1);
  const pageSize = Number(searchParams.get("page_size") || 12);

  useEffect(() => {
    // Only run on the /saved route
    if (!location.pathname.endsWith("/saved")) return;

    const controller = new AbortController();
    const url = `/patches/saved-by/${encodeURIComponent(username)}/?page=${page}&page_size=${pageSize}`;

    (async () => {
      try {
        const res = await API.get(url, { signal: controller.signal });
        const payload = res.data;
        const results = Array.isArray(payload) ? payload : (payload.results || []);
        const count = Array.isArray(payload) ? payload.length : (payload.count ?? results.length);
        setData({ results, count, next: payload.next ?? null, previous: payload.previous ?? null });
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;

        const status = err?.response?.status;
        const body = err?.response?.data || err.message;
        setError(`${status || ""} ${typeof body === "string" ? body : JSON.stringify(body)}`);

        // If private list (403), bounce back to the public profile
        if (status === 403) {
          navigate(`/users/${username}`);
          return;
        }

        // Fallback only if viewer is the owner
        try {
          const [meRes, targetRes] = await Promise.all([
            API.get(`/users/me/`, { signal: controller.signal }),
            API.get(`/users/username/${encodeURIComponent(username)}/`, { signal: controller.signal })
          ]);
          const meId = meRes?.data?.id;
          const targetId = targetRes?.data?.id;
          if (meId && targetId && meId === targetId) {
            const all = await API.get(`/patches/?uploaded_by=${targetId}`, { signal: controller.signal });
            const list = Array.isArray(all.data) ? all.data : (all.data.results || []);
            const saved = list.filter(p => !p.is_posted);
            setData({ results: saved, count: saved.length, next: null, previous: null });
            setError(null);
          }
        } catch {}
      }
    })();

    return () => controller.abort();
  }, [username, page, pageSize, navigate, location.pathname]);

  const goPage = (p) => setSearchParams({ page: String(p), page_size: String(pageSize) });
  const totalPages = Math.max(1, Math.ceil((data.count || 0) / pageSize));

  return (
    <div style={{ padding: "20px" }}>
      <h2>{username} - Saved patches</h2>
      {error && <div style={{ color: "crimson", fontSize: 12 }}>Error: {error}</div>}

      {data.results.length === 0 && !error && <p>No saved patches to show.</p>}

      {data.results.length > 0 && (
        <ul>
          {data.results.map(p => (
            <li key={p.id}>
              <strong><Link to={`/patches/${p.id}`}>{p.name}</Link></strong>{" "}
              (created {new Date(p.created_at).toLocaleString()})
              {p.is_posted ? " • posted" : " • not posted"}
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button disabled={page <= 1} onClick={() => goPage(page - 1)}>Prev</button>
        <span>Page {page} of {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => goPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
