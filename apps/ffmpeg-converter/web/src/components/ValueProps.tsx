// Three-card value-prop row per spec §7.1: "In your browser",
// "No watermark", "Real ffmpeg under the hood". Static, no interactivity.

const CARDS = [
  {
    title: 'In your browser',
    body: 'Small files convert client-side. Your file never leaves your device for the wasm-supported subset.',
  },
  {
    title: 'No watermark, no signup',
    body: 'No email gate, no account prompt, no logo stamped on your output. Free is actually free.',
  },
  {
    title: 'Real ffmpeg under the hood',
    body: 'Every job shows the equivalent ffmpeg command, with a copy button. Take it and run it yourself.',
  },
];

export function ValueProps() {
  return (
    <section aria-labelledby="value-props-heading" className="w-full">
      <h2 id="value-props-heading" className="sr-only">
        Why use Sean&apos;s Converter
      </h2>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CARDS.map((card) => (
          <li
            key={card.title}
            className="rounded-xl border border-gray-800 bg-gray-900/40 p-6"
          >
            <h3 className="mb-2 text-lg font-semibold text-gray-100">
              {card.title}
            </h3>
            <p className="text-sm leading-relaxed text-gray-400">{card.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
