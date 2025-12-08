import { useEffect, useRef, useState } from 'react';

const TIME_COEFF = 1.5 / 100;

const initialNodes = {
  pyramid: { name: 'Pyramid Stage', x: 400, y: 270 },
  westHolts: { name: 'West Holts', x: 450, y: 300 },
  acoustic: { name: 'Acoustic Stage', x: 200, y: 500 },
  node1: { x: 300, y: 300 },
};

const initialEdges = [
  { from: 'pyramid', to: 'westHolts', name: 'Past West Holts' },
  { from: 'westHolts', to: 'acoustic', name: 'Through the forest' },
  { from: 'pyramid', to: 'node1' },
  { from: 'node1', to: 'acoustic' },
];

const distanceBetween = (a, b) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const Popover = ({ x, y, children }) => (
  <foreignObject x={x + 10} y={y - 36} width={220} height={100}>
    <div
      style={{
        userSelect: 'none',
        background: 'rgba(0,0,0,0.85)',
        color: '#fff',
        padding: '5px 10px',
        borderRadius: '5px',
        fontSize: '13px',
        pointerEvents: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  </foreignObject>
);

const MapNetwork = () => {
  const svgRef = useRef(null);
  const dragNode = useRef(null);
  const dragOffset = useRef({});
  const selectionStart = useRef(null);

  const [nodes, setNodes] = useState(() => {
    const stored = localStorage.getItem('glastoMapData');
    return stored ? JSON.parse(stored).nodes : initialNodes;
  });
  const [edges, setEdges] = useState(() => {
    const stored = localStorage.getItem('glastoMapData');
    return stored ? JSON.parse(stored).edges : initialEdges;
  });

  const [editMode, setEditMode] = useState(false);
  const [hover, setHover] = useState(null);
  const [showPopovers, setShowPopovers] = useState(false);
  const [activeNode, setActiveNode] = useState(null);
  const [selectedEdgeIndex, setSelectedEdgeIndex] = useState(null);
  const [zen, setZen] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState(new Set());
  const [selectionBox, setSelectionBox] = useState(null);

  useEffect(() => {
    localStorage.setItem('glastoMapData', JSON.stringify({ nodes, edges }));
  }, [nodes, edges]);

  const generateNodeId = () => {
    let id;
    do {
      id = `node${Math.floor(Math.random() * 1e6)}`;
    } while (nodes[id]);
    return id;
  };

  // Main SVG click handler: shift+click node or empty space
  const handleSvgClick = (e) => {
    console.log('svgclick!', activeNode);
    if (!editMode || !e.shiftKey) {
      setActiveNode(null);
      setSelectedEdgeIndex(null);
      setSelectedNodes(new Set());
      return;
    }

    // Only create a new node if not clicking on an existing node.
    // Node clicks will stop propagation, so this only fires for the SVG bg.
    const rect = svgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const id = generateNodeId();

    setNodes((prev) => ({ ...prev, [id]: { x, y } }));
    if (activeNode) {
      setEdges((prev) => [...prev, { from: activeNode, to: id }]);
    }

    setActiveNode(id);
    setSelectedEdgeIndex(null);
    setSelectedNodes(new Set([id]));
    setZen(true);
  };

  // Node click: just select (no shift), or create edge if shift+click with active node
  const handleNodeClick = (e, id) => {
    e.stopPropagation();
    if (!editMode) return;

    if (e.shiftKey && activeNode && activeNode !== id) {
      console.log('setting edge');
      setEdges((prev) => [...prev, { from: activeNode, to: id }]);
      return;
    }

    // If not shift, set activeNode
    setActiveNode(id);
    setSelectedEdgeIndex(null);
    setSelectedNodes(new Set([id]));
    setZen(false);
  };

  const handleMouseDown = (e, id = null) => {
    if (!editMode) return;
    console.log('handleMouseDown', id);

    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (id) {
      const isSelected = selectedNodes.has(id);
      const dragSet = isSelected ? selectedNodes : new Set([id]);
      dragNode.current = new Set(dragSet);
      dragOffset.current = {};
      for (const nodeId of dragSet) {
        const node = nodes[nodeId];
        dragOffset.current[nodeId] = {
          dx: x - node.x,
          dy: y - node.y,
        };
      }
    } else {
      selectionStart.current = { x, y };
      setSelectionBox({ x1: x, y1: y, x2: x, y2: y });
    }
  };

  const handleMouseMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (dragNode.current) {
      setNodes((prev) => {
        const updated = { ...prev };
        for (const id of dragNode.current) {
          const { dx, dy } = dragOffset.current[id];
          updated[id] = {
            ...updated[id],
            x: Math.max(0, Math.min(rect.width, x - dx)),
            y: Math.max(0, Math.min(rect.height, y - dy)),
          };
        }
        return updated;
      });
    } else if (selectionStart.current) {
      setSelectionBox((prev) => ({
        ...prev,
        x2: x,
        y2: y,
      }));
    }
  };

  const handleMouseUp = () => {
    dragNode.current = null;

    if (selectionBox && selectionStart.current) {
      const { x1, y1, x2, y2 } = selectionBox;
      const [minX, maxX] = [Math.min(x1, x2), Math.max(x1, x2)];
      const [minY, maxY] = [Math.min(y1, y2), Math.max(y1, y2)];

      const selected = new Set(
        Object.entries(nodes)
          .filter(
            ([, { x, y }]) => x >= minX && x <= maxX && y >= minY && y <= maxY,
          )
          .map(([id]) => id),
      );

      setSelectedNodes(selected);
      setActiveNode(null);
      setSelectedEdgeIndex(null);
    }

    selectionStart.current = null;
    setSelectionBox(null);
  };

  const updateEdgeName = (index, newName) => {
    setEdges((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], name: newName };
      return copy;
    });
  };

  const updateNodeName = (id, newName) => {
    setNodes((prev) => ({
      ...prev,
      [id]: { ...prev[id], name: newName },
    }));
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Backspace') return;

      e.preventDefault();

      if (selectedNodes.size > 0) {
        setNodes((prev) => {
          const copy = { ...prev };
          for (const id of selectedNodes) delete copy[id];
          return copy;
        });
        setEdges((prev) =>
          prev.filter(
            (e) => !selectedNodes.has(e.from) && !selectedNodes.has(e.to),
          ),
        );
        setSelectedNodes(new Set());
      } else if (selectedEdgeIndex !== null) {
        setEdges((prev) => prev.filter((_, i) => i !== selectedEdgeIndex));
        setSelectedEdgeIndex(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodes, selectedEdgeIndex]);

  return (
    <div style={{ position: 'relative', width: 600, margin: 'auto' }}>
      <button
        type="button"
        onClick={() => setEditMode((v) => !v)}
        style={{ marginRight: 8 }}
      >
        {editMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
      </button>
      <button
        type="button"
        onClick={() => setShowPopovers((v) => !v)}
        style={{ marginRight: 8 }}
      >
        {showPopovers ? 'Hide Popovers' : 'Show Popovers'}
      </button>
      <textarea
        readOnly
        value={JSON.stringify({ nodes, edges }, null, 2)}
        style={{ width: '100%', height: 150, marginTop: 10 }}
      />
      <div style={{ position: 'relative' }}>
        <img
          src="https://glastonburyfestivals.co.uk/wp-content/uploads/2025/05/Glastonbury-Access_map_2025_V5.png"
          alt="Map"
          style={{
            width: '100%',
            pointerEvents: 'none',
            opacity: editMode ? 0.4 : 0.9,
          }}
        />
        <svg
          ref={svgRef}
          style={{ position: 'absolute', top: 0, left: 0 }}
          width="100%"
          height="100%"
          onClick={handleSvgClick}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onMouseDown={(e) => handleMouseDown(e)}
        >
          {edges.map(({ from, to, name }, idx) => {
            const a = nodes[from],
              b = nodes[to];
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            const dist = distanceBetween(a, b);
            const time = dist * TIME_COEFF;
            const active = selectedEdgeIndex === idx;
            const show =
              !zen &&
              (showPopovers ||
                active ||
                (hover?.type === 'edge' && hover.idx === idx));

            return (
              <g
                key={idx}
                onClick={(e) => {
                  if (!editMode) return;
                  e.stopPropagation();
                  setSelectedEdgeIndex(idx);
                  setActiveNode(null);
                  setSelectedNodes(new Set());
                  setZen(false);
                }}
                onMouseEnter={() =>
                  setHover({
                    type: 'edge',
                    idx,
                    x: midX,
                    y: midY,
                    name,
                    dist,
                    time,
                  })
                }
                onMouseLeave={() => setHover(null)}
                style={{ cursor: editMode ? 'pointer' : 'default' }}
              >
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={active ? '#f39c12' : '#3498db'}
                  strokeWidth={3}
                />
                {show && (
                  <Popover x={midX} y={midY}>
                    <div>
                      <div>
                        {Math.round(dist)}px, {time.toFixed(1)}min
                      </div>
                      {editMode && active && (
                        <input
                          type="text"
                          value={name || ''}
                          onChange={(e) => updateEdgeName(idx, e.target.value)}
                          style={{ width: '100%', marginTop: 4 }}
                        />
                      )}
                    </div>
                  </Popover>
                )}
              </g>
            );
          })}

          {Object.entries(nodes).map(([id, node]) => {
            const active = activeNode === id || selectedNodes.has(id);
            // Hide popovers if multiselect is active
            const showPopover =
              !zen &&
              selectedNodes.size <= 1 &&
              (showPopovers ||
                active ||
                (hover?.type === 'node' && hover.id === id));
            return (
              <g
                key={id}
                onMouseEnter={() =>
                  setHover({
                    type: 'node',
                    id,
                    x: node.x,
                    y: node.y,
                    name: node.name,
                  })
                }
                onMouseLeave={() => setHover(null)}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.name ? 6 : 4}
                  visibility={node.name || editMode ? 'visible' : 'hidden'}
                  fill={active ? 'green' : node.name ? '#e74c3c' : '#bbb'}
                  stroke="#fff"
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onMouseDown={(e) => handleMouseDown(e, id)}
                  onClick={(e) => handleNodeClick(e, id)}
                />
                {showPopover && (
                  <Popover x={node.x} y={node.y}>
                    <div>
                      {editMode && activeNode === id ? (
                        <input
                          type="text"
                          value={node.name || ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateNodeName(id, e.target.value)}
                          placeholder="Node name"
                          style={{ width: '100%', marginTop: 4 }}
                        />
                      ) : (
                        <div>{node.name || id}</div>
                      )}
                    </div>
                  </Popover>
                )}
              </g>
            );
          })}

          {selectionBox && (
            <rect
              x={Math.min(selectionBox.x1, selectionBox.x2)}
              y={Math.min(selectionBox.y1, selectionBox.y2)}
              width={Math.abs(selectionBox.x2 - selectionBox.x1)}
              height={Math.abs(selectionBox.y2 - selectionBox.y1)}
              fill="rgba(52, 152, 219, 0.2)"
              stroke="#3498db"
              strokeDasharray="4"
            />
          )}
        </svg>
      </div>
    </div>
  );
};

export { MapNetwork };
