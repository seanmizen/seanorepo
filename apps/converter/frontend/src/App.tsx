import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import Home from '@/pages/Home';
import ConvertPair from '@/pages/ConvertPair';
import { PAIRS } from '@/data/pairs';

// URL convention is **locked** by apps/converter/CLAUDE.md Directive 1.
// Landing pages are verb-first flat slugs (`/convert-mp4-to-gif`). `/convert`
// only exists so that users who type it don't hit a 404 — it Navigate-replaces
// to `/`. A real 301 still needs to be served at the edge (nginx/Cloudflare)
// for SEO; see todo.md.
export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/convert" element={<Navigate to="/" replace />} />
          {PAIRS.map((pair) => (
            <Route
              key={pair.slug}
              path={`/${pair.slug}`}
              element={<ConvertPair pair={pair} />}
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
