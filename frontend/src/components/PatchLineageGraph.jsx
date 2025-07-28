import React, { useEffect, useState, useRef } from 'react';
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
                setNodes(res.data.nodes);
                setEdges(res.data.edges);
            } catch (err) {
                console.error('Failed to load patch lineage:', err);
            }
        };

        fetchLineage();
    }, [patchId]);

    // Mouse wheel zoom
    const handleWheel = (e) => {
        e.preventDefault();
        const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
        setTransform(prev => {
            const newScale = Math.max(0.2, Math.min(4, prev.scale * scaleChange));
            return { ...prev, scale: newScale };
        });
    };

    // Drag pan
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

    const handleMouseUp = () => {
        dragging.current = false;
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
                {edges.map((edge, i) => {
                    const from = nodes.find(n => n.id === edge.from);
                    const to = nodes.find(n => n.id === edge.to);
                    if (!from || !to) return null;
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

                {nodes.map((node) => (
                    <g key={node.id}>
                        <circle
                            cx={node.x}
                            cy={node.y}
                            r={NODE_RADIUS + Math.min(node.downloads || 0, 30) * 0.5}
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

                {hovered && (
                    <foreignObject x={hovered.x + 10} y={hovered.y - 30} width="180" height="50">
                        <div style={{
                            background: 'white',
                            border: '1px solid black',
                            padding: '4px',
                            borderRadius: '4px',
                            fontSize: '10px'
                        }}>
                            <strong>{hovered.name}</strong><br />
                            v{hovered.version}
                        </div>
                    </foreignObject>
                )}
            </g>
        </svg>
    );
};

export default PatchLineageGraph;
