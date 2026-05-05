// 12-flagship pill row from STRATEGY.md. Two rows of six on desktop, wraps
// on smaller breakpoints. Each pill is an anchor to the canonical tool page
// — pure server component, no client JS.

import Link from 'next/link';
import { FLAGSHIP_PRESETS } from './flagship-data';

export function FlagshipPills() {
  return (
    <nav aria-label="Popular conversions" className="w-full">
      <h2 className="mb-4 text-center text-sm font-medium uppercase tracking-wider text-gray-400">
        Popular conversions
      </h2>
      <ul className="flex flex-wrap justify-center gap-2">
        {FLAGSHIP_PRESETS.map((preset) => (
          <li key={preset.op}>
            <Link
              href={preset.href}
              className={[
                'inline-flex items-center rounded-full',
                'border border-gray-700 bg-gray-900/60 px-4 py-2',
                'text-sm font-medium text-gray-100',
                'transition-colors',
                'hover:border-indigo-500 hover:bg-indigo-500/10 hover:text-white',
              ].join(' ')}
            >
              {preset.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
