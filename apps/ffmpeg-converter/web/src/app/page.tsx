import Link from 'next/link';
import { HomePicker } from '@/components/HomePicker';
import { TOOLS } from '@/tools';

export default function Home() {
  const popular = TOOLS.filter((t) => t.popular);
  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 sm:px-6 sm:pt-16">
      <h1 className="text-4xl font-bold tracking-tight text-fg sm:text-5xl">
        Convert video, audio and images
      </h1>
      <p className="mt-3 text-lg text-muted">Free. No sign-up. No watermark.</p>

      <div className="mt-8">
        <HomePicker />
      </div>

      <section aria-labelledby="popular-heading" className="mt-14">
        <h2 id="popular-heading" className="text-xl font-semibold text-fg">
          Popular
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {popular.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/${t.slug}`}
                className="flex min-h-14 items-center justify-center rounded-xl border border-line bg-surface px-3 text-center font-medium text-fg hover:border-accent"
              >
                {t.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
