import { toQueryString } from '@shared/filters';
import type {
  DesignerListResponse,
  DesignerProfile,
  PublicProject,
} from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/config';
import { get } from '@/lib/http';

/**
 * The public designer list.
 *
 * The query string is built by the shared serialiser, so what the browser
 * shows in the address bar and what the API receives are produced by the same
 * code — a filtered URL a buyer shares always reproduces their exact view.
 */
export const useDesigners = (filters: Record<string, unknown>) =>
  useQuery({
    queryKey: ['designers', filters],
    queryFn: () =>
      get<DesignerListResponse>(
        `${api.endpoints.designers}${toQueryString(filters, { page: 1, limit: 24 })}`,
      ),
  });

export const useDesigner = (slug: string) =>
  useQuery({
    queryKey: ['designer', slug],
    queryFn: () =>
      get<{ profile: DesignerProfile; portfolioProjects: PublicProject[] }>(
        `${api.endpoints.designers}/${encodeURIComponent(slug)}`,
      ),
  });

export const usePortfolioProject = (slug: string, projectSlug: string) =>
  useQuery({
    queryKey: ['portfolio', slug, projectSlug],
    queryFn: () =>
      get<{ profile: DesignerProfile; project: PublicProject }>(
        `${api.endpoints.designers}/${encodeURIComponent(slug)}/portfolio/${encodeURIComponent(projectSlug)}`,
      ),
  });

/** Turns `50k_100k` into `£50k–£100k`, and `full_home` into `Full home`. */
export const humanise = (value: string | null): string => {
  if (!value) return '';
  const band = value.match(/^(under_|)(\d+k)(?:_(\d+k|plus))?/);
  if (band && value.includes('k')) {
    if (value.startsWith('under_')) return `Under £${band[2]}`;
    if (value.endsWith('_plus')) return `£${band[2]}+`;
    const [low, high] = value.split('_');
    return `£${low}–£${high}`;
  }
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};
