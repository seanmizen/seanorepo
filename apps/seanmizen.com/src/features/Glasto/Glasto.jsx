import { useState } from "react";

const locations = [
  { name: "Pyramid Stage" },
  { name: "Other Stage" },
  { name: "John Peel Stage" },
  { name: "The Park" },
  { name: "West Holts" },
  { name: "Arcadia" },
  { name: "Green Fields" },
];

const walkingTimes = {
  "Pyramid Stage-Other Stage": 10,
  "Pyramid Stage-John Peel Stage": 12,
  "Other Stage-West Holts": 8,
  "The Park-Arcadia": 15,
  "West Holts-Green Fields": 14,
  // Add more as needed
};

const getRandomLocation = (exclude = "") => {
  let locs = locations.filter((l) => l.name !== exclude);
  return locs[Math.floor(Math.random() * locs.length)].name;
};

const getRandomPair = () => {
  let a = locations[Math.floor(Math.random() * locations.length)].name;
  let b = getRandomLocation(a);
  return [a, b];
};

const questionTypes = [
  "stage", // e.g. "Where is the Pyramid Stage?"
  "route", // e.g. "Fastest route between X and Y"
  "walkTime", // e.g. "Walking time between A and B"
];

const getRandomQuestion = () => {
  const type = questionTypes[Math.floor(Math.random() * questionTypes.length)];
  if (type === "stage") {
    const stage = getRandomLocation();
    return {
      type,
      prompt: `Where is the ${stage}?`,
      answer: `At the ${stage} area`, // Replace with real area/descriptions if needed
    };
  }
  if (type === "route") {
    const [a, b] = getRandomPair();
    return {
      type,
      prompt: `Fastest route between ${a} and ${b}?`,
      answer: `Follow main festival paths from ${a} to ${b}`, // Replace with real route logic
    };
  }
  if (type === "walkTime") {
    const [a, b] = getRandomPair();
    const key = `${a}-${b}`;
    const revKey = `${b}-${a}`;
    const time = walkingTimes[key] || walkingTimes[revKey] || "unknown";
    return {
      type,
      prompt: `Walking time between ${a} and ${b}?`,
      answer: typeof time === "number" ? `${time} min` : time,
    };
  }
};

const Glasto = () => {
  const [q, setQ] = useState(getRandomQuestion());
  const [showAnswer, setShowAnswer] = useState(false);

  const next = () => {
    setQ(getRandomQuestion());
    setShowAnswer(false);
  };

  return (
    <div
      style={{
        maxWidth: 440,
        margin: "2em auto",
        padding: 20,
        borderRadius: 12,
        boxShadow: "0 4px 18px #ccc",
        fontFamily: "sans-serif",
        background: "#fff",
      }}
    >
      <h2 style={{ marginBottom: 20 }}>Glastonbury Flashcards</h2>
      <div style={{ fontSize: 20, minHeight: 60, marginBottom: 20 }}>
        {q.prompt}
      </div>
      <button
        onClick={() => setShowAnswer(true)}
        style={{
          padding: "8px 18px",
          borderRadius: 8,
          border: "none",
          background: "#333",
          color: "#fff",
          marginRight: 12,
        }}
        disabled={showAnswer}
      >
        Show Answer
      </button>
      <button
        onClick={next}
        style={{
          padding: "8px 18px",
          borderRadius: 8,
          border: "none",
          background: "#eee",
          color: "#333",
        }}
      >
        Next
      </button>
      {showAnswer && (
        <div style={{ marginTop: 28, fontSize: 18, color: "#31773b" }}>
          {q.answer}
        </div>
      )}
    </div>
  );
};

export { Glasto };
