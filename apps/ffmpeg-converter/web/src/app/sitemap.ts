import type { MetadataRoute } from 'next';
import { TOOLS } from '@/tools';

const ORIGIN = 'https://seansconverter.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${ORIGIN}/`, priority: 1 },
    ...TOOLS.map((t) => ({
      url: `${ORIGIN}/${t.slug}`,
      priority: t.popular ? 0.9 : 0.7,
    })),
  ];
}
