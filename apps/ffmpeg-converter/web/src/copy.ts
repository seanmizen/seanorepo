// Marketing copy for Sean's Converter site.
// Pulled straight from STRATEGY.md. Voice: direct, a bit wry, technical when it
// counts. Sean's existing site style: minimal, no-nonsense, mono for facts.

export const headline = 'Convert anything, instantly';

export const subheadline =
  'Video \u00b7 Audio \u00b7 Images \u2014 fast, free, private';

export const bullets: { title: string; body: string }[] = [
  {
    title: 'Drop, convert, done.',
    body: 'Drag a file onto the page. We suggest the best format. You click once. No wizard, no multi-step form.',
  },
  {
    title: '50+ conversions, zero complexity.',
    body: '50 operations across video, audio, and images — trims, crops, resizes, bitrate targeting, loudness normalisation, contact sheets. Advanced panel when you need it.',
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
    gotcha: 'No tricks, presets shareable',
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
    a: 'Files are written to a local disk on the converter machine and deleted one hour after conversion. There is no off-site backup, no S3, no analytics pipeline.',
  },
  {
    q: 'Why is there no login?',
    a: 'Because a converter is a tool, not a product. Logins mean accounts, accounts mean passwords, passwords mean leaks, leaks mean a bad afternoon. Your preferences live in your own browser localStorage.',
  },
  {
    q: "What's the file size limit?",
    a: 'Soft cap at 500 MB right now. Larger files may time out or fail depending on the conversion type.',
  },
  {
    q: 'Is this open source?',
    a: 'Yes. The backend and this web UI live in a public monorepo. PRs welcome, but fair warning: this is a personal site, not a company.',
  },
  {
    q: 'What formats do you support?',
    a: 'Over 50 operations across video, audio, and images. Check the full catalog for the complete list — everything from MOV to MP4, PNG to WebP, video to GIF, and much more.',
  },
];

export const footerLine = 'Files auto-delete after one hour.';
