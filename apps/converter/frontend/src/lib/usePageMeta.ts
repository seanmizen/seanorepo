import { useEffect } from 'react';

interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  // Arbitrary schema.org JSON-LD blocks keyed by a stable id. Each block is
  // injected as its own <script type="application/ld+json"> and removed on
  // unmount, so per-page HowTo / Breadcrumb / FAQ schemas stay per-page.
  jsonLd?: Record<string, unknown>;
}

function upsertMetaByName(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertMetaByProperty(property: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(href: string) {
  let el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

// Keeps document head tags in sync with the current route. This is the
// minimum viable SSR-less SEO — crawlers that execute JS (Googlebot,
// ClaudeBot, PerplexityBot) will see the updated tags. Once traffic
// justifies it we can upgrade to rsbuild SSR or static prerender.
export function usePageMeta({ title, description, canonical, jsonLd }: PageMeta) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    upsertMetaByName('description', description);
    upsertMetaByProperty('og:title', title);
    upsertMetaByProperty('og:description', description);
    upsertMetaByProperty('og:url', canonical);
    upsertCanonical(canonical);

    const scriptIds: string[] = [];
    if (jsonLd) {
      for (const [key, block] of Object.entries(jsonLd)) {
        const id = `jsonld-${key}`;
        scriptIds.push(id);
        let script = document.getElementById(id) as HTMLScriptElement | null;
        if (!script) {
          script = document.createElement('script');
          script.id = id;
          script.type = 'application/ld+json';
          document.head.appendChild(script);
        }
        script.textContent = JSON.stringify(block);
      }
    }

    return () => {
      document.title = prevTitle;
      for (const id of scriptIds) {
        document.getElementById(id)?.remove();
      }
    };
  }, [title, description, canonical, jsonLd]);
}
