import React, { useState } from "react";
import { MapNetwork } from "./Map";

const locations = [
  "Pyramid Stage",
  "Other Stage",
  "The Park",
  "West Holts",
  "Arcadia",
  "Green Fields",
  "Acoustic Stage",
  "Silver Hayes",
  "Shangri-La",
  "Woodsies",
  "William's Green",
  "Left Field",
  "Avalon",
  "The Glade",
];

const walkingTimes = {
  "Pyramid Stage-Other Stage": 10,
  "Pyramid Stage-West Holts": 8,
  "Pyramid Stage-The Park": 15,
  "West Holts-Arcadia": 7,
  "Arcadia-Green Fields": 10,
  "Shangri-La-The Park": 20,
  "Acoustic Stage-Avalon": 5,
  "Silver Hayes-Woodsies": 6,
  "William's Green-Left Field": 4,
  "Avalon-The Glade": 3,
  // Add additional accurate times as needed
};

const randomPair = () => {
  const a = locations[Math.floor(Math.random() * locations.length)];
  let b;
  do {
    b = locations[Math.floor(Math.random() * locations.length)];
  } while (a === b);
  return [a, b];
};

const getQuestion = () => {
  const types = ["location", "route", "walkTime"];
  const type = types[Math.floor(Math.random() * types.length)];

  if (type === "location") {
    const stage = locations[Math.floor(Math.random() * locations.length)];
    return {
      prompt: `Where is the ${stage}?`,
      answer: `Located at the ${stage} area.`,
    };
  }

  if (type === "route") {
    const [from, to] = randomPair();
    return {
      prompt: `Fastest route from ${from} to ${to}?`,
      answer: `Use main paths from ${from} toward ${to}.`,
    };
  }

  const [a, b] = randomPair();
  const key = `${a}-${b}`;
  const revKey = `${b}-${a}`;
  const time = walkingTimes[key] || walkingTimes[revKey] || "Unknown";

  return {
    prompt: `Walking time between ${a} and ${b}?`,
    answer: typeof time === "number" ? `${time} minutes` : time,
  };
};

const Glasto = () => {
  const [current, setCurrent] = useState(getQuestion());
  const [showAnswer, setShowAnswer] = useState(false);

  const nextCard = () => {
    setCurrent(getQuestion());
    // setShowAnswer(false);
  };

  return (
    <div
      style={{
        // maxWidth: 480,
        margin: "2rem auto",
        padding: "1.5rem",
        borderRadius: "12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        background: "#fff",
        fontFamily: "sans-serif",
      }}
    >
      <h2 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>
        Glastonbury Flashcards
      </h2>

      <div style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>
        {current.prompt}
      </div>

      <button
        onClick={() => setShowAnswer(!showAnswer)}
        style={{
          padding: "8px 16px",
          borderRadius: "8px",
          border: "none",
          background: "#333",
          color: "#fff",
          cursor: "pointer",
          marginRight: "10px",
        }}
      >
        Toggle Answer
      </button>

      <button
        onClick={nextCard}
        style={{
          padding: "8px 16px",
          borderRadius: "8px",
          border: "none",
          background: "#ddd",
          color: "#333",
          cursor: "pointer",
        }}
      >
        Next
      </button>

      {showAnswer && (
        <div
          style={{ marginTop: "1rem", color: "#31773b", fontSize: "1.2rem" }}
        >
          {current.answer}
          <MapNetwork />
        </div>
      )}

      {/* <div style={{ marginTop: "1.5rem" }}>
        <img
          src="https://camptriangle.co.uk/__data/assets/image/0016/4615/Glastonbury-Access_map_2025_V5-with-CT.png"
          alt="Glastonbury Festival Map"
          style={{
            maxWidth: "100%",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        />
        <div
          style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#555" }}
        >
          Map integration coming soon!
        </div>
      </div> */}
    </div>
  );
};

export { Glasto };
