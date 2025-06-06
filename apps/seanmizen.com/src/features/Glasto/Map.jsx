import React, { useState, useRef } from "react";

const TIME_COEFF = 1.5 / 100;

const initialNodes = {
  pyramid: { name: "Pyramid Stage", x: 400, y: 270 },
  westHolts: { name: "West Holts", x: 450, y: 300 },
  acoustic: { name: "Acoustic Stage", x: 200, y: 500 },
  node1: { x: 300, y: 300 },
};

const initialEdges = [
  { from: "pyramid", to: "westHolts", name: "Past West Holts" },
  { from: "westHolts", to: "acoustic", name: "Through the forest" },
  { from: "pyramid", to: "node1" },
  { from: "node1", to: "acoustic" },
];

const distanceBetween = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const Popover = ({ x, y, children }) => (
  <foreignObject x={x + 10} y={y - 36} width={180} height={200}>
    <div
      style={{
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        padding: "5px 10px",
        borderRadius: "5px",
        fontSize: "13px",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  </foreignObject>
);

const MapNetwork = () => {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const [hover, setHover] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [alwaysShowPopovers, setAlwaysShowPopovers] = useState(false);
  const [activeNode, setActiveNode] = useState(null);
  const nodeIdRef = useRef(1000);
  const svgRef = useRef(null);

  const addNode = (e) => {
    if (!editMode) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const id = `node${nodeIdRef.current++}`;

    setNodes((prev) => ({ ...prev, [id]: { x, y } }));

    if (activeNode) {
      setEdges((prev) => [...prev, { from: activeNode, to: id }]);
    }
    setActiveNode(id);
  };

  const toggleEdit = () => {
    setEditMode((prev) => !prev);
    setActiveNode(null);
  };
  const togglePopovers = () => setAlwaysShowPopovers((prev) => !prev);

  return (
    <div style={{ position: "relative", width: 600, margin: "auto" }}>
      <button
        onClick={toggleEdit}
        style={{ marginRight: 10, zIndex: 10, position: "relative" }}
      >
        {editMode ? "Exit Edit Mode" : "Enter Edit Mode"}
      </button>
      <button
        onClick={togglePopovers}
        style={{ zIndex: 10, position: "relative" }}
      >
        {alwaysShowPopovers ? "Hide Popovers" : "Show Popovers"}
      </button>
      <textarea
        readOnly
        value={JSON.stringify({ nodes, edges }, null, 2)}
        style={{
          width: "100%",
          height: 150,
          margin: "10px 0",
          zIndex: 10,
          position: "relative",
        }}
      />
      <div style={{ position: "relative" }}>
        <img
          src="https://camptriangle.co.uk/__data/assets/image/0016/4615/Glastonbury-Access_map_2025_V5-with-CT.png"
          alt="Glastonbury Map"
          style={{
            width: "100%",
            display: "block",
            pointerEvents: "none",
            userSelect: "none",
          }}
        />
        <svg
          ref={svgRef}
          onDoubleClick={addNode}
          style={{ position: "absolute", top: 0, left: 0 }}
          width="100%"
          height="600"
        >
          {edges.map(({ from, to, name }, idx) => {
            const fromNode = nodes[from];
            const toNode = nodes[to];
            const dist = distanceBetween(fromNode, toNode);
            const time = dist * TIME_COEFF;
            const midX = (fromNode.x + toNode.x) / 2;
            const midY = (fromNode.y + toNode.y) / 2;

            return (
              <line
                key={idx}
                x1={fromNode.x}
                y1={fromNode.y}
                x2={toNode.x}
                y2={toNode.y}
                stroke="#3498db"
                strokeWidth={3}
                style={{ cursor: "pointer", pointerEvents: "all" }}
                onMouseEnter={() =>
                  setHover({ x: midX, y: midY, name, dist, time })
                }
                onMouseLeave={() => setHover(null)}
              />
            );
          })}

          {Object.entries(nodes).map(([id, node]) =>
            node.name || editMode ? (
              <circle
                key={id}
                cx={node.x}
                cy={node.y}
                r={node.name ? 10 : 6}
                fill={
                  activeNode === id ? "green" : node.name ? "#e74c3c" : "#bbb"
                }
                stroke="#fff"
                strokeWidth={2}
                style={{ cursor: "pointer", pointerEvents: "all" }}
                onClick={() => editMode && setActiveNode(id)}
                onMouseEnter={() =>
                  setHover({ x: node.x, y: node.y, name: node.name })
                }
                onMouseLeave={() => setHover(null)}
              />
            ) : null
          )}

          {(alwaysShowPopovers || hover) && hover && (
            <Popover x={hover.x} y={hover.y}>
              {hover.name && <div>{hover.name}</div>}
              {hover.dist && (
                <div>
                  Distance: {hover.dist.toFixed(0)} px
                  <br />
                  Walking time: {hover.time.toFixed(1)} min
                </div>
              )}
            </Popover>
          )}
        </svg>
      </div>
    </div>
  );
};

export { MapNetwork };
