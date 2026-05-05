// Sean's Converter — homepage. Spec §7.1.
//
// Layout (top → bottom, mobile and desktop both):
//   1. Logotype + nav (lives in layout.tsx)
//   2. One-line headline + sub-head
//   3. Drop zone (HeroDrop) — above the fold, full-width
//   4. 12 flagship pills (FlagshipPills)
//   5. Three-card value-prop row (ValueProps)
//   6. Footer with /llms.txt placeholder (SiteFooter, in layout.tsx)
//
// The drop zone routes by file extension — see route-for-file.ts.

import { FlagshipPills } from '@/components/FlagshipPills';
import { HeroDrop } from '@/components/HeroDrop';
import { ValueProps } from '@/components/ValueProps';

export default function Home() {
  return (
    <>
      <section className="mx-auto max-w-3xl px-6 pt-12 pb-6 text-center md:pt-20">
        <h1 className="text-balance text-4xl font-bold tracking-tight text-gray-100 md:text-5xl">
          Convert, compress, and trim video.
        </h1>
        <p className="mt-4 text-balance text-lg text-gray-400">
          In your browser. No watermark, no signup, no email gate. The ffmpeg
          command is shown for every job.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-10">
        <HeroDrop />
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16">
        <FlagshipPills />
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16">
        <ValueProps />
      </section>
    </>
  );
}
