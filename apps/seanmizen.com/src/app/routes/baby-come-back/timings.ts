/* Loop ranges in the official PlayerVEVO upload of "Baby Come Back" by
   Player, in seconds of that video.

   The song runs at about 76.7 BPM. A half chorus is 16 beats (12.52 s) and
   a full chorus is 32 beats (25.04 s). These numbers come from an onset
   cross-correlation of the two halves of the first chorus. Each range below
   is a whole number of beats long, so the loop keeps time.

   `blend` is the crossfade length. The fade is centred on `end` for the
   outgoing copy and on `start` for the incoming copy, so a loop period is
   always exactly `end - start`. A blend of 0 is a hard cut. */

type Timing = {
  id: string;
  label: string;
  start: number;
  end: number;
  blend: number;
};

const VIDEO_ID = 'NmEyGiaqm7k';

const TIMINGS: Timing[] = [
  { id: 'chorus', label: 'the chorus', start: 63.45, end: 88.49, blend: 0.6 },
  {
    id: 'chorus-slow',
    label: 'the chorus, slow blend',
    start: 63.45,
    end: 88.49,
    blend: 1.6,
  },
  {
    id: 'chorus-cut',
    label: 'the chorus, hard cut',
    start: 63.45,
    end: 88.49,
    blend: 0,
  },
  {
    id: 'fool',
    label: 'any kind of fool could see',
    start: 63.45,
    end: 75.97,
    blend: 0.5,
  },
  {
    id: 'blame',
    label: 'you can blame it all on me',
    start: 75.97,
    end: 88.49,
    blend: 0.5,
  },
  {
    id: 'second',
    label: 'second chorus',
    start: 119.68,
    end: 144.72,
    blend: 0.6,
  },
  {
    id: 'final',
    label: 'final chorus (listen baby)',
    start: 173.98,
    end: 199.02,
    blend: 0.6,
  },
  {
    id: 'stuck',
    label: 'baby come back (stuck)',
    start: 75.97,
    end: 79.1,
    blend: 0.25,
  },
];

export type { Timing };
export { TIMINGS, VIDEO_ID };
