import React, { useEffect, useState, useRef, useMemo } from 'react';
import API from '../api';

const NODE_RADIUS = 20;

const PatchLineageGraph = ({ patchId }) => {
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
        const res = await API.get(`/patches/${patchId}/lineage/`);
        setNodes(res.data.nodes || []);
        setEdges(res.data.edges || []);
      } catch (err) {
        console.error('Failed to load patch lineage:', err);
      }
    };
    fetchLineage();
  }, [patchId]);

  // Quick id -> node map
  const nodeById = useMemo(() => {
    const m = new Map();
    nodes.forEach(n => m.set(n.id, n));
    return m;
  }, [nodes]);

  // Zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => {
      const newScale = Math.max(0.2, Math.min(4, prev.scale * scaleChange));
      return { ...prev, scale: newScale };
    });
  };

  // Pan
  const handleMouseDown = (e) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseMove = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  };
  const handleMouseUp = () => { dragging.current = false; };

  // Geometry helpers
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
    const PAD = 6; // a little buffer outside the visual radius
    for (const n of nodes) {
      if (n.id === from.id || n.id === to.id) continue;
      const d = distancePointToSegment(n.x, n.y, x1, y1, x2, y2);
      if (d <= nodeVisualRadius(n) + PAD) return true;
    }
    return false;
  };

  // Quadratic curve around obstacles; offset perpendicular to the segment
  const curvedPath = (sx, sy, tx, ty, bias = 1) => {
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    let dx = tx - sx, dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular unit vector
    const nx = -dy / len;
    const ny =  dx / len;
    // Control distance: bias lets us push a bit more for later siblings
    const CTRL = 60 + 10 * (Math.max(1, bias) - 1);
    const cx = mx + nx * CTRL * (bias % 2 === 0 ? 1 : -1);
    const cy = my + ny * CTRL * (bias % 2 === 0 ? 1 : -1);
    return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
  };

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="700"
      style={{ border: '1px solid #ccc', cursor: dragging.current ? 'grabbing' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
        {/* Edges */}
        {edges.map((edge, i) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          if (!from || !to) return null;

          const stackedRank = to.sibling_rank || 1;

          // Curve if: later sibling OR the straight line would pass through a node
          const mustCurve = stackedRank > 1 || edgeWouldHitNode(from, to);

          if (mustCurve) {
            const d = curvedPath(from.x, from.y, to.x, to.y, stackedRank);
            return (
              <path
                key={i}
                d={d}
                stroke="gray"
                strokeWidth="2"
                fill="none"
              />
            );
          }

          // Straight edge otherwise
          return (
            <line
              key={i}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="gray"
              strokeWidth="2"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={nodeVisualRadius(node)}
              fill={node.isCurrent ? 'blue' : 'lightgray'}
              stroke="black"
              strokeWidth="1"
              onMouseEnter={() => setHovered(node)}
              onMouseLeave={() => setHovered(null)}
            />
            {node.is_posted && (
              <a href={`/patches/${node.id}`}>
                <text
                  x={node.x}
                  y={node.y - NODE_RADIUS - 6}
                  textAnchor="middle"
                  fontSize="10"
                  fill="black"
                >
                  v{node.version}
                </text>
              </a>
            )}
          </g>
        ))}

        {/* Tooltip */}
        {hovered && (
          <foreignObject x={hovered.x + 10} y={hovered.y - 30} width="200" height="60">
            <div style={{
              background: 'white',
              border: '1px solid black',
              padding: '4px',
              borderRadius: '4px',
              fontSize: '10px',
              pointerEvents: 'none'
            }}>
              <strong>{hovered.name}</strong><br />
              v{hovered.version}<br />
              {hovered.uploaded_by ? <em>by {hovered.uploaded_by}</em> : null}
            </div>
          </foreignObject>
        )}
      </g>
    </svg>
  );
};

export default PatchLineageGraph;
