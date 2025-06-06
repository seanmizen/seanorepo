import React, { useState } from "react";

const nodes = {
  pyramid: { name: "Pyramid Stage", x: 150, y: 100 },
  westHolts: { name: "West Holts", x: 450, y: 300 },
  acoustic: { name: "Acoustic Stage", x: 200, y: 500 },
};

const edges = [
  { from: "pyramid", to: "westHolts", name: "Past West Holts" },
  { from: "westHolts", to: "acoustic", name: "Through the forest" },
  { from: "pyramid", to: "acoustic" },
];

const distanceBetween = (a, b) => {
  const dx = nodes[a].x - nodes[b].x;
  const dy = nodes[a].y - nodes[b].y;
  return Math.sqrt(dx * dx + dy * dy);
};

const Popover = ({ x, y, text }) => (
  <foreignObject x={x + 10} y={y - 30} width={150} height={30}>
    <div
      style={{
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        padding: "3px 6px",
        borderRadius: "4px",
        fontSize: "12px",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {text}
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
        style={{ position: "absolute", top: 0, left: 0 }}
        width="100%"
        height="100%"
      >
        {edges.map(({ from, to, name }, idx) => (
          <line
            key={idx}
            x1={nodes[from].x}
            y1={nodes[from].y}
            x2={nodes[to].x}
            y2={nodes[to].y}
            stroke="#3498db"
            strokeWidth={3}
            onMouseEnter={() =>
              name &&
              setHover({
                x: (nodes[from].x + nodes[to].x) / 2,
                y: (nodes[from].y + nodes[to].y) / 2,
                text: name,
              })
            }
            onMouseLeave={() => setHover(null)}
            style={{ cursor: name ? "pointer" : "default" }}
          />
        ))}

        {Object.entries(nodes).map(([id, node]) => (
          <circle
            key={id}
            cx={node.x}
            cy={node.y}
            r={8}
            fill="#e74c3c"
            stroke="#fff"
            strokeWidth={2}
            onMouseEnter={() =>
              setHover({ x: node.x, y: node.y, text: node.name })
            }
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "pointer" }}
          />
        ))}

        {hover && <Popover x={hover.x} y={hover.y} text={hover.text} />}
      </svg>
    </div>
  );
};

export { MapNetwork };
