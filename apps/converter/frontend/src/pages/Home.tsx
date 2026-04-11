import { Link } from 'react-router-dom';
import { Converter } from '@/components/Converter';
import { BRAND } from '@/lib/brand';
import { usePageMeta } from '@/lib/usePageMeta';
import { PAIRS } from '@/data/pairs';

export default function Home() {
  usePageMeta({
    title: `${BRAND.name} — Convert anything, instantly`,
    description: BRAND.description,
    canonical: `${BRAND.origin}/`,
  });

  return (
    <>
      <section style={{ textAlign: 'center', marginBottom: '2rem', maxWidth: '560px' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em' }}>
          Convert anything, instantly
        </h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          Video · Audio · Images — fast, free, private
        </p>
      </section>

      <Converter />

      <section
        style={{
          marginTop: '2.5rem',
          width: '100%',
          maxWidth: '520px',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontSize: '0.8rem',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            marginBottom: '0.75rem',
          }}
        >
          Popular conversions
        </p>
        <ul
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '0.5rem',
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {PAIRS.map((p) => (
            <li key={p.slug}>
              <Link
                to={`/${p.slug}`}
                style={{
                  display: 'inline-block',
                  padding: '0.45rem 0.85rem',
                  borderRadius: '999px',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  textDecoration: 'none',
                  border: '1px solid var(--border)',
                }}
              >
                {p.fromLabel} → {p.toLabel}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
