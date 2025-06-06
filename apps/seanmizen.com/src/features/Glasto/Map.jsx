import React, { useState, useRef, useEffect } from "react";

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

const distanceBetween = (a, b) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const Popover = ({ x, y, children }) => (
  <foreignObject x={x + 10} y={y - 36} width={220} height={240}>
    <div
      style={{
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        padding: "5px 10px",
        borderRadius: "5px",
        fontSize: "13px",
        pointerEvents: "auto",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  </foreignObject>
);

const generateUniqueId = (existing) => {
  let id;
  do {
    id = "node" + Math.random().toString(36).slice(2, 10);
  } while (existing[id]);
  return id;
};

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

const MapNetwork = () => {
  const loadData = () => {
    const stored = localStorage.getItem("glastoMapData");
    return stored
      ? JSON.parse(stored)
      : { nodes: initialNodes, edges: initialEdges };
  };

  const [nodes, setNodes] = useState(loadData().nodes);
  const [edges, setEdges] = useState(loadData().edges);
  const [editMode, setEditMode] = useState(false);
  const [showPopovers, setShowPopovers] = useState(false);
  const [hover, setHover] = useState(null);
  const [activeNode, setActiveNode] = useState(null);
  const [selectedEdgeIndex, setSelectedEdgeIndex] = useState(null);
  const [zen, setZen] = useState(false);
  const svgRef = useRef(null);
  const dragNode = useRef(null);

  useEffect(() => {
    localStorage.setItem("glastoMapData", JSON.stringify({ nodes, edges }));
  }, [nodes, edges]);

  const resetNodes = () => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    localStorage.removeItem("glastoMapData");
    setActiveNode(null);
    setSelectedEdgeIndex(null);
  };

  const handleSvgClick = (e) => {
    if (!editMode || !e.shiftKey) {
      setActiveNode(null);
      setSelectedEdgeIndex(null);
      return;
    }
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = generateUniqueId(nodes);

    setNodes((prev) => ({ ...prev, [id]: { x, y } }));
    if (activeNode) {
      setEdges((prev) => [...prev, { from: activeNode, to: id }]);
    }

    setActiveNode(id);
    setSelectedEdgeIndex(null);
    setZen(true);
  };

  const deleteNode = (id) => {
    setNodes(({ [id]: _, ...rest }) => rest);
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    if (activeNode === id) setActiveNode(null);
  };

  const handleNodeClick = (e, id) => {
    e.stopPropagation();
    if (!editMode) return;

    if (e.shiftKey && activeNode && activeNode !== id) {
      setEdges((prev) => [...prev, { from: activeNode, to: id }]);
    }

    setZen(false);
    setActiveNode((prev) => (prev === id ? null : id));
    setSelectedEdgeIndex(null);
  };

  const handleMouseDown = (id) => {
    if (!editMode) return;
    dragNode.current = id;
  };

  const handleMouseUp = () => {
    dragNode.current = null;
  };

  const handleMouseMove = (e) => {
    if (!editMode || !dragNode.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const y = clamp(e.clientY - rect.top, 0, rect.height);

    setNodes((prev) => ({
      ...prev,
      [dragNode.current]: { ...prev[dragNode.current], x, y },
    }));
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
      if (!editMode || !(e.metaKey || e.ctrlKey) || e.key !== "Backspace")
        return;

      e.preventDefault();

      if (activeNode) {
        deleteNode(activeNode);
      } else if (selectedEdgeIndex !== null) {
        setEdges((prev) => prev.filter((_, i) => i !== selectedEdgeIndex));
        setSelectedEdgeIndex(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, activeNode, selectedEdgeIndex]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 800,
        margin: "auto",
      }}
    >
      <button onClick={() => setEditMode((p) => !p)} style={{ marginRight: 8 }}>
        {editMode ? "Exit Edit Mode" : "Enter Edit Mode"}
      </button>
      <button
        onClick={() => setShowPopovers((p) => !p)}
        style={{ marginRight: 8 }}
      >
        {showPopovers ? "Hide Popovers" : "Show Popovers"}
      </button>
      <button onClick={resetNodes}>Reset Nodes</button>

      <textarea
        readOnly
        value={JSON.stringify({ nodes, edges }, null, 2)}
        style={{ width: "100%", height: 150, marginTop: 10 }}
      />

      <div style={{ position: "relative" }}>
        <img
          src="https://camptriangle.co.uk/__data/assets/image/0016/4615/Glastonbury-Access_map_2025_V5-with-CT.png"
          alt="Glastonbury Map"
          style={{
            width: "100%",
            display: "block",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
        <svg
          ref={svgRef}
          viewBox="0 0 600 600"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
          }}
          onClick={handleSvgClick}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {edges.map(({ from, to, name }, idx) => {
            const a = nodes[from],
              b = nodes[to];
            const dist = distanceBetween(a, b);
            const time = dist * TIME_COEFF;
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            const isActive = selectedEdgeIndex === idx;

            const shouldShow =
              !zen &&
              (showPopovers ||
                (hover?.type === "edge" && hover.idx === idx) ||
                (editMode && isActive));

            return (
              <g
                key={idx}
                onClick={(e) => {
                  if (!editMode) return;
                  e.stopPropagation();
                  setSelectedEdgeIndex(idx);
                  setActiveNode(null);
                  setZen(false);
                }}
                onMouseEnter={() =>
                  !zen &&
                  setHover({
                    type: "edge",
                    x: midX,
                    y: midY,
                    idx,
                    name,
                    dist,
                    time,
                  })
                }
                onMouseLeave={() => !zen && setHover(null)}
                style={{ cursor: editMode ? "pointer" : "default" }}
              >
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={isActive ? "#f39c12" : "#3498db"}
                  strokeWidth={3}
                />
                {shouldShow && (
                  <Popover x={midX} y={midY}>
                    <div>
                      <div>
                        {Math.round(dist)}px, {time.toFixed(1)}min
                      </div>
                      {editMode && isActive && (
                        <input
                          type="text"
                          value={name || ""}
                          onChange={(e) => updateEdgeName(idx, e.target.value)}
                          placeholder="Edge name"
                          style={{ width: "100%", marginTop: 4 }}
                        />
                      )}
                    </div>
                  </Popover>
                )}
              </g>
            );
          })}

          {Object.entries(nodes).map(([id, node]) =>
            node.name || editMode ? (
              <g
                key={id}
                onMouseEnter={() =>
                  !zen &&
                  setHover({
                    type: "node",
                    x: node.x,
                    y: node.y,
                    id,
                    name: node.name,
                  })
                }
                onMouseLeave={() => !zen && setHover(null)}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.name ? 6 : 4}
                  fill={
                    activeNode === id ? "green" : node.name ? "#e74c3c" : "#bbb"
                  }
                  stroke="#fff"
                  strokeWidth={2}
                  style={{ cursor: "pointer" }}
                  onMouseDown={() => handleMouseDown(id)}
                  onClick={(e) => handleNodeClick(e, id)}
                />
                {!zen &&
                  (showPopovers ||
                    (hover?.type === "node" && hover.id === id) ||
                    (editMode && activeNode === id)) && (
                    <Popover x={node.x} y={node.y}>
                      <div>
                        {editMode && activeNode === id ? (
                          <input
                            type="text"
                            value={node.name || ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateNodeName(id, e.target.value)}
                            placeholder="Node name"
                            style={{ width: "100%", marginTop: 4 }}
                          />
                        ) : (
                          <div>{node.name || id}</div>
                        )}
                        {editMode && activeNode === id && (
                          <button
                            style={{ fontSize: 10, marginTop: 4 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNode(id);
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </Popover>
                  )}
              </g>
            ) : null
          )}
        </svg>
      </div>
    </div>
  );
};

export { MapNetwork };
