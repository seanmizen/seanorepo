import React, { useState } from "react";

// 1.5 mins per 100px as example (calibrate to your map later)
const TIME_COEFF = 1.5 / 100;

const nodes = {
  pyramid: { name: "Pyramid Stage", x: 400, y: 270 },
  westHolts: { name: "West Holts", x: 450, y: 300 },
  acoustic: { name: "Acoustic Stage", x: 200, y: 500 },
  // unnamed node: node4 (a junction, not rendered)
  node1: { x: 300, y: 300 },
  // node2: { x: 100, y: 200 },
};

const edges = [
  { from: "pyramid", to: "westHolts", name: "Past West Holts" },
  { from: "westHolts", to: "acoustic", name: "Through the forest" },
  { from: "pyramid", to: "node1" }, // unnamed edge
  { from: "node1", to: "acoustic" }, // unnamed edge
];

const distanceBetween = (a, b) => {
  const dx = nodes[a].x - nodes[b].x;
  const dy = nodes[a].y - nodes[b].y;
  return Math.sqrt(dx * dx + dy * dy);
};

const Popover = ({ x, y, children }) => (
  <foreignObject
    x={x + 10}
    y={y - 36}
    width={180}
    // minHeight={36}
    height={200}
  >
    <div
      style={{
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        padding: "5px 10px",
        // height: "200px",
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
  const [hover, setHover] = useState(null);

  return (
    <div style={{ position: "relative", width: 600, margin: "auto" }}>
      <img
        src="https://camptriangle.co.uk/__data/assets/image/0016/4615/Glastonbury-Access_map_2025_V5-with-CT.png"
        alt="Glastonbury Map"
        style={{ width: "100%", display: "block" }}
      />
      <svg
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
        width="100%"
        height="100%"
      >
        {edges.map(({ from, to, name }, idx) => {
          const x1 = nodes[from].x,
            y1 = nodes[from].y;
          const x2 = nodes[to].x,
            y2 = nodes[to].y;
          const dist = distanceBetween(from, to);
          const time = dist * TIME_COEFF;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          return (
            <g
              key={idx}
              style={{ pointerEvents: "all" }}
              onMouseEnter={() =>
                setHover({
                  type: "edge",
                  x: midX,
                  y: midY,
                  name,
                  distance: dist,
                  time,
                })
              }
              onMouseLeave={() => setHover(null)}
            >
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#3498db"
                strokeWidth={3}
                style={{ cursor: "pointer" }}
              />
            </g>
          );
        })}

        {Object.entries(nodes).map(([id, node]) =>
          node.name ? (
            <g
              key={id}
              style={{ pointerEvents: "all" }}
              onMouseEnter={() =>
                setHover({
                  type: "node",
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
                r={10}
                fill="#e74c3c"
                stroke="#fff"
                strokeWidth={2}
                style={{ cursor: "pointer" }}
              />
            </g>
          ) : null
        )}

        {hover && hover.type === "node" && (
          <Popover x={hover.x} y={hover.y}>
            {hover.name}
          </Popover>
        )}

        {hover && hover.type === "edge" && (
          <Popover x={hover.x} y={hover.y}>
            {hover.name && <div>{hover.name}</div>}
            <div>
              Distance: {hover.distance.toFixed(0)} px
              <br />
              Walking time: {hover.time.toFixed(1)} min
            </div>
          </Popover>
        )}
      </svg>
    </div>
  );
};

export { MapNetwork };
