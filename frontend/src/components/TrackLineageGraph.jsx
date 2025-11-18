// src/components/TrackLineageGraph.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import API from '../api';

const NODE_RADIUS = 20;
const H_SPACING = 160;
const V_SPACING = 60;

export default function TrackLineageGraph({ trackId }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [hovered, setHovered] = useState(null);

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const svgRef = useRef(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const fetchLineage = async () => {
      try {
        const res = await API.get(`/tracks/${trackId}/lineage/`);
        setNodes(res.data?.nodes || []);
        setEdges(res.data?.edges || []);
      } catch (err) {
        console.error('Failed to load track lineage:', err);
      }
    };
    fetchLineage();
  }, [trackId]);

  // Build display nodes, adding ghost placeholders for missing endpoints.
  const displayNodes = useMemo(() => {
    const byId = new Map();
    (nodes || []).forEach(n => byId.set(n.id, { ...n, isGhost: false }));

    const ghostCountFor = new Map();
    const addGhost = (id, anchor, direction = -1) => {
      const count = (ghostCountFor.get(anchor.id) || 0) + 1;
      ghostCountFor.set(anchor.id, count);
      const dx = direction * H_SPACING;
      const dy = (count - 1) * (V_SPACING / 2);
      const x = (anchor.x ?? 0) + dx;
      const y = (anchor.y ?? 0) + dy;
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          x,
          y,
          name: 'Unavailable track',
          version: null,
          is_posted: false,
          isCurrent: false,
          isGhost: true
        });
      }
    };

    for (const e of edges || []) {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (from && to) continue;
      if (!from && to) addGhost(e.from, to, -1);
      if (!to && from) addGhost(e.to, from, +1);
    }

    return Array.from(byId.values());
  }, [nodes, edges]);

  // Fast id -> node map
  const nodeById = useMemo(() => {
    const m = new Map();
    displayNodes.forEach(n => m.set(n.id, n));
    return m;
  }, [displayNodes]);

  // Determine which nodes are linkable (exist and are retrievable)
  const [linkable, setLinkable] = useState(new Set());
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ids = displayNodes.filter(n => !n.isGhost).map(n => n.id);
      const unique = Array.from(new Set(ids));
      const results = await Promise.allSettled(unique.map(id => API.get(`/tracks/${id}/`)));
      const ok = new Set();
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok.add(unique[i]);
      });
      if (!cancelled) setLinkable(ok);
    };
    if (displayNodes.length) check();
    return () => { cancelled = true; };
  }, [displayNodes]);

  // Zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => ({ ...prev, scale: Math.max(0.2, Math.min(4, prev.scale * scaleChange)) }));
  };

  // Pan
  const handleMouseDown = (e) => { dragging.current = true; lastPos.current = { x: e.clientX, y: e.clientY }; };
  const handleMouseMove = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  };
  const handleMouseUp = () => { dragging.current = false; };

  // Geometry
  const nodeVisualRadius = (n) => NODE_RADIUS + Math.min(n.downloads || 0, 30) * 0.5;

  const distancePointToSegment = (px, py, x1, y1, x2, y2) => {
    const vx = x2 - x1, vy = y2 - y1;
    const wx = px - x1, wy = py - y1;
    const vv = vx*vx + vy*vy;
    if (vv === 0) return Math.hypot(px - x1, py - y1);
    let t = (wx*vx + wy*vy) / vv;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t*vx, cy = y1 + t*vy;
    return Math.hypot(px - cx, py - cy);
  };

  const edgeWouldHitNode = (from, to) => {
    const x1 = from.x, y1 = from.y;
    const x2 = to.x, y2 = to.y;
    const PAD = 6;
    for (const n of displayNodes) {
      if (n.id === from.id || n.id === to.id) continue;
      const d = distancePointToSegment(n.x, n.y, x1, y1, x2, y2);
      if (d <= nodeVisualRadius(n) + PAD) return true;
    }
    return false;
  };

  const curvedPath = (sx, sy, tx, ty, bias = 1) => {
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    let dx = tx - sx, dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny =  dx / len;
    const CTRL = 60 + 10 * (Math.max(1, bias) - 1);
    const cx = mx + nx * CTRL * (bias % 2 === 0 ? 1 : -1);
    const cy = my + ny * CTRL * (bias % 2 === 0 ? 1 : -1);
    return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
  };

  return (
    <div className="lineage-graph">
      <svg
        ref={svgRef}
        width="100%"
        height="700"
        style={{
          border: '1px solid var(--panel-border)',
          cursor: dragging.current ? 'grabbing' : 'grab',
          background: 'transparent'
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        aria-label="Track lineage graph"
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>

          {/* Edges (colour comes from CSS tokens) */}
          {(edges || []).map((edge, i) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;

            const stackedRank = to.sibling_rank || 1;
            const mustCurve = stackedRank > 1 || edgeWouldHitNode(from, to);

            if (mustCurve) {
              const d = curvedPath(from.x, from.y, to.x, to.y, stackedRank);
              return <path key={i} className="edge" d={d} strokeWidth="2" fill="none" />;
            }

            return <line key={i} className="edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth="2" />;
          })}

          {/* Nodes */}
          {displayNodes.map((n) => {
            const r = nodeVisualRadius(n);
            const linkAllowed = linkable.has(n.id);
            const unavailable = !linkAllowed;

            // Colours driven by tokens; only the "current" state gets an accent fill.
            const fill = n.isCurrent ? 'var(--btn-primary-bg)' : 'var(--graph-node-bg)';
            const stroke = 'var(--graph-node-stroke)';
            const dash = unavailable ? '6 4' : undefined;
            const label = `v${n.version ?? '?.?'}`;

            return (
              <g key={n.id}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  fill={fill}
                  stroke={stroke}
                  strokeDasharray={dash}
                  strokeWidth="1"
                  onMouseEnter={() => setHovered(n)}
                  onMouseLeave={() => setHovered(null)}
                />
                {linkAllowed ? (
                  <a href={`/tracks/${n.id}`} style={{ pointerEvents: 'auto' }}>
                    <text
                      x={n.x}
                      y={n.y - r - 6}
                      textAnchor="middle"
                      fontSize="11"
                      className="version"
                    >
                      {label}
                    </text>
                  </a>
                ) : (
                  <text
                    x={n.x}
                    y={n.y - r - 6}
                    textAnchor="middle"
                    fontSize="11"
                    className="version"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Tooltip (uses panel tokens so it flips nicely in dark mode) */}
          {hovered && (
            <foreignObject x={hovered.x + 10} y={hovered.y - 30} width="220" height="70">
              <div
                style={{
                  background: 'var(--panel-bg)',
                  color: 'var(--panel-fg)',
                  border: '1px solid var(--panel-border)',
                  padding: '4px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  boxShadow: 'var(--panel-elevation)',
                  pointerEvents: 'none'
                }}
              >
                <strong>{hovered.name || 'Track'}</strong><br />
                {`v${hovered.version ?? '?.?'}`}<br />
                {hovered.uploaded_by ? <em>by {hovered.uploaded_by}</em> : <em>unavailable</em>}
              </div>
            </foreignObject>
          )}

        </g>
      </svg>
    </div>
  );
}
