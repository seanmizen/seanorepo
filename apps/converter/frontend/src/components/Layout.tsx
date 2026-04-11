import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '@/lib/brand';

interface LayoutProps {
  children: ReactNode;
}

// Single shell reused by every route so the header, footer, and page chrome
// stay consistent. Landing pages render their own H1 inside `children`.
export function Layout({ children }: LayoutProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '2rem 1rem',
      }}
    >
      <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <Link
          to="/"
          style={{
            color: 'inherit',
            textDecoration: 'none',
            fontSize: '1.25rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          {BRAND.name}
        </Link>
      </header>

      <main
        style={{
          flex: 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {children}
      </main>

      <footer
        style={{
          marginTop: '3rem',
          color: 'var(--text-muted)',
          fontSize: '0.8rem',
          textAlign: 'center',
        }}
      >
        Files are deleted automatically after 1 hour · Powered by ffmpeg
      </footer>
    </div>
  );
}
