// Marketing copy for Sean's Converter site.
// Pulled straight from STRATEGY.md. Voice: direct, a bit wry, technical when it
// counts. Sean's existing site style: minimal, no-nonsense, mono for facts.

export const headline = 'Convert anything to anything.';

export const subheadline =
  'Free, instant, no signup. Your file never leaves further than it has to.';

export const bullets: { title: string; body: string }[] = [
  {
    title: 'Drop, convert, done.',
    body: 'Drag a file onto the page. We suggest the best format. You click once. No wizard, no multi-step form.',
  },
  {
    title: 'All of ffmpeg, none of the complexity.',
    body: '50 operations across video, audio, and images — trims, crops, resizes, bitrate targeting, loudness normalisation, contact sheets. Advanced panel for codec, CRF, fps, and filters when you need them.',
  },
  {
    title: 'See the command.',
    body: 'Every option maps to a live ffmpeg command you can copy and run in your own terminal. Nothing hidden.',
  },
  {
    title: 'Shareable presets.',
    body: 'The URL is the state. Bookmark it and you have a one-click tool. Send it to a colleague and they get the same preset, ready to go.',
  },
  {
    title: 'No login. No account. Ever.',
    body: 'Your presets live in localStorage on your device. We have nothing to forget because we never knew you.',
  },
];

// Short, comparative pitch against each competitor — used in the comparison table.
// Numbers sourced from COMPETITORS.md; update both when the landscape shifts.
export interface Competitor {
  name: string;
  freeFileCap: string;
  freeCount: string;
  login: string;
  paid: string;
  gotcha: string;
}

export const competitors: Competitor[] = [
  {
    name: "Sean's Converter (us)",
    freeFileCap: 'Generous',
    freeCount: 'Generous',
    login: 'Never',
    paid: 'Free',
    gotcha: 'Command + presets visible',
  },
  {
    name: 'CloudConvert',
    freeFileCap: '25 MB',
    freeCount: '10/day, 25 min total',
    login: 'Optional',
    paid: '$12+/mo',
    gotcha: 'Hard cap on free size',
  },
  {
    name: 'Zamzar',
    freeFileCap: '50 MB total',
    freeCount: '2 files / 24 h',
    login: 'Optional',
    paid: '$9+/mo',
    gotcha: 'Emails you the result',
  },
  {
    name: 'FreeConvert',
    freeFileCap: '1 GB',
    freeCount: '10/day (less for video)',
    login: 'Optional',
    paid: '$9.99+/mo',
    gotcha: 'Ads on every step',
  },
  {
    name: 'Convertio',
    freeFileCap: '100 MB',
    freeCount: '10/day, 10 min total',
    login: 'Optional',
    paid: '$25.99/mo',
    gotcha: 'Result page ad rail',
  },
  {
    name: 'Online-Convert',
    freeFileCap: '100 MB',
    freeCount: '3/day',
    login: 'Optional',
    paid: '~$7+/mo',
    gotcha: 'UI stuck in 2010',
  },
  {
    name: 'VEED.io',
    freeFileCap: '1 GB',
    freeCount: 'Unlimited (watermark)',
    login: 'Required',
    paid: '$12+/mo',
    gotcha: 'Full editor — overkill',
  },
];

export const faq: { q: string; a: string }[] = [
  {
    q: 'Do you store my files?',
    a: 'Server-side jobs are written to a local disk on the converter machine and deleted one hour after conversion. There is no off-site backup, no S3, no analytics pipeline. In the planned browser-WASM lane, your file never leaves the tab.',
  },
  {
    q: 'Why is there no login?',
    a: 'Because a converter is a tool, not a product. Logins mean accounts, accounts mean passwords, passwords mean leaks, leaks mean a bad afternoon. Your preferences live in your own browser localStorage — export them as JSON if you want to move machines.',
  },
  {
    q: "What can this do that ffmpeg can't?",
    a: 'Nothing — we shell out to ffmpeg. The point of the site is the UI: a drop zone, a sensible default for every conversion, a preset library, and a shareable URL. Your terminal will always win on flexibility. We win on "I\'m on someone else\'s laptop."',
  },
  {
    q: "What's the file size limit?",
    a: 'Soft cap at 500 MB on the server lane right now — the Go backend loads files into memory before handing them to ffmpeg, so a huge file can OOM the box. Larger than that and we suggest the CLI.',
  },
  {
    q: 'Is this open source?',
    a: 'Yes. The Go backend and this web UI live in the monorepo at apps/ffmpeg-converter/. PRs welcome, but fair warning: this is a personal site, not a company.',
  },
  {
    q: 'What if I want my own ffmpeg flags?',
    a: "Copy the live command from the panel, paste it into your terminal, edit to taste. The site is an honest front door — it's not trying to trap you.",
  },
  {
    q: 'Why do you show the ffmpeg command?',
    a: "Because you should be able to see what the computer is about to do. Every other converter hides this; we think that's a missed opportunity and a trust-building move.",
  },
];

export const footerLine = 'Files auto-delete after one hour.';
