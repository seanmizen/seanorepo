import type {
  DesignerProfile,
  DesignerProfileStatus,
  Project,
} from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/config';

export interface AdminDesignerListItem {
  id: number;
  slug: string;
  studioName: string;
  location: string | null;
  status: DesignerProfileStatus;
  submittedAt: string;
  reviewedAt: string | null;
  projectCount: number;
}

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { credentials: 'include', ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
};

export const useReviewQueue = (status: DesignerProfileStatus | 'all') =>
  useQuery({
    queryKey: ['admin', 'designers', status],
    queryFn: () =>
      request<{ designers: AdminDesignerListItem[]; total: number }>(
        status === 'all'
          ? `${api.endpoints.adminDesigners}?limit=100`
          : `${api.endpoints.adminDesigners}?status=${status}&limit=100`,
      ),
  });

export const useDesignerUnderReview = (id: number) =>
  useQuery({
    queryKey: ['admin', 'designer', id],
    queryFn: () =>
      request<{ profile: DesignerProfile; projects: Project[] }>(
        `${api.endpoints.adminDesigners}/${id}`,
      ),
    retry: false,
  });

/** Approve or reject, then refresh the queue so the decision is visible at once. */
export const useReviewDecision = (id: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      decision,
      note,
    }: {
      decision: 'approve' | 'reject';
      note: string;
    }) =>
      request<{ profile: DesignerProfile }>(
        `${api.endpoints.adminDesigners}/${id}/${decision}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: note || undefined }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });
};
