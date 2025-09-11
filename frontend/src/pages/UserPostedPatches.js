import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, useLocation, Link } from "react-router-dom";
import API from "../api";

export default function UserPostedPatches() {
  const { username } = useParams();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ results: [], count: 0, next: null, previous: null });
  const [error, setError] = useState(null);

  const page = Number(searchParams.get("page") || 1);
  const pageSize = Number(searchParams.get("page_size") || 12);

  useEffect(() => {
    // Only run on the /posted route
    if (!location.pathname.endsWith("/posted")) return;

    const controller = new AbortController();
    const url = `/patches/posted-by/${encodeURIComponent(username)}/?page=${page}&page_size=${pageSize}`;

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

        // Fallback: fetch by uploaded_by and filter posted
        try {
          const u = await API.get(`/users/username/${encodeURIComponent(username)}/`, { signal: controller.signal });
          const all = await API.get(`/patches/?uploaded_by=${u.data?.id}`, { signal: controller.signal });
          const list = Array.isArray(all.data) ? all.data : (all.data.results || []);
          const posted = list.filter(p => p.is_posted);
          setData({ results: posted, count: posted.length, next: null, previous: null });
          setError(null);
        } catch {}
      }
    })();

    return () => controller.abort();
  }, [username, page, pageSize, location.pathname]);

  const goPage = (p) => setSearchParams({ page: String(p), page_size: String(pageSize) });
  const totalPages = Math.max(1, Math.ceil((data.count || 0) / pageSize));

  return (
    <div style={{ padding: "20px" }}>
      <h2>{username} - Posted patches</h2>
      {error && <div style={{ color: "crimson", fontSize: 12 }}>Error: {error}</div>}

      {data.results.length === 0 && !error && <p>No posted patches yet.</p>}

      {data.results.length > 0 && (
        <ul>
          {data.results.map(p => (
            <li key={p.id}>
              <strong><Link to={`/patches/${p.id}`}>{p.name}</Link></strong>{" "}
              ({new Date(p.created_at).toLocaleString()})
              {p.version ? <> - v{p.version}</> : null}
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
