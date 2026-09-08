import type {
  Bid,
  BriefListResponse,
  OwnedBrief,
  PublicBrief,
  ReceivedBid,
} from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/config';
import { ApiError, request } from '@/lib/http';

/**
 * Post-a-project, both sides of it.
 *
 * A buyer posts a brief and manages the responses. A designer reads the board
 * and answers one. The two sides never share an endpoint: `/briefs` is the
 * public board and carries no `buyerId` (REQ-BRIEF-002), while everything
 * under `/me` is owner-scoped and behind a role guard.
 */

export { ApiError };

const BRIEFS = `${api.baseUrl}/briefs`;
const MY_BRIEFS = `${api.baseUrl}/me/briefs`;

/** The public board. Readable by anyone, including nobody. */
export const useBriefBoard = (page: number) =>
  useQuery({
    queryKey: ['briefs', page],
    queryFn: () => request<BriefListResponse>(`${BRIEFS}?page=${page}`),
    retry: false,
  });

/**
 * One brief by slug.
 *
 * `isOwner` comes from the server rather than a client-side comparison,
 * because the server is the only side that knows who the buyer is — the
 * public shape deliberately omits `buyerId`.
 */
export const useBrief = (slug: string | undefined) =>
  useQuery({
    queryKey: ['brief', slug],
    queryFn: () =>
      request<{ brief: PublicBrief; isOwner: boolean }>(`${BRIEFS}/${slug}`),
    enabled: Boolean(slug),
    retry: false,
  });

/** The buyer's own briefs, drafts included. */
export const useMyBriefs = () =>
  useQuery({
    queryKey: ['my-briefs'],
    queryFn: () => request<{ briefs: OwnedBrief[] }>(MY_BRIEFS),
    retry: false,
  });

export const useMyBrief = (id: number | null) =>
  useQuery({
    queryKey: ['my-brief', id],
    queryFn: () => request<{ brief: OwnedBrief }>(`${MY_BRIEFS}/${id}`),
    enabled: id !== null,
    retry: false,
  });

/** The bids a buyer has received. Served only to the brief's owner. */
export const useReceivedBids = (id: number | null) =>
  useQuery({
    queryKey: ['brief-bids', id],
    queryFn: () => request<{ bids: ReceivedBid[] }>(`${MY_BRIEFS}/${id}/bids`),
    enabled: id !== null,
    retry: false,
  });

export interface BriefDraft {
  title: string;
  description: string;
  workType: string;
  budgetBand: string;
  location: string;
  timeline: string;
}

/** Blank means "not set" to the API, which wants null rather than ''. */
const forApi = (draft: BriefDraft) =>
  Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [
      key,
      value.trim().length === 0 ? null : value.trim(),
    ]),
  );

const invalidateBriefs = (client: ReturnType<typeof useQueryClient>) => {
  client.invalidateQueries({ queryKey: ['my-briefs'] });
  client.invalidateQueries({ queryKey: ['briefs'] });
};

export const useCreateBrief = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: BriefDraft) =>
      request<{ brief: OwnedBrief }>(MY_BRIEFS, {
        method: 'POST',
        body: JSON.stringify(forApi(draft)),
      }),
    onSuccess: () => invalidateBriefs(client),
  });
};

export const useUpdateBrief = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id: number; draft: BriefDraft }) =>
      request<{ brief: OwnedBrief }>(`${MY_BRIEFS}/${id}`, {
        method: 'PUT',
        body: JSON.stringify(forApi(draft)),
      }),
    onSuccess: (_data, variables) => {
      invalidateBriefs(client);
      client.invalidateQueries({ queryKey: ['my-brief', variables.id] });
    },
  });
};

/**
 * Publishing and closing are separate switches, and so are the buttons.
 *
 * REQ-BRIEF-001: visibility and publication answer different questions, and a
 * control that did both would recreate the ambiguity the schema removed.
 */
export const useBriefAction = (action: 'publish' | 'unpublish' | 'close') => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<{ brief: OwnedBrief }>(`${MY_BRIEFS}/${id}/${action}`, {
        method: 'POST',
      }),
    onSuccess: (_data, id) => {
      invalidateBriefs(client);
      client.invalidateQueries({ queryKey: ['my-brief', id] });
    },
  });
};

/**
 * Start or continue a bid.
 *
 * The endpoint is idempotent by design: a designer who already has a draft
 * gets that same row back rather than a second one or an error. Only a bid
 * they have already SENT answers 409, which the UI must show as "you have
 * already responded" rather than as a failure.
 */
export const useStartBid = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      briefId,
      message,
      budgetBand,
      availability,
    }: {
      briefId: number;
      message: string;
      budgetBand: string;
      availability: string;
    }) =>
      request<{ bid: Bid }>(`${BRIEFS}/${briefId}/bids`, {
        method: 'POST',
        body: JSON.stringify({
          message,
          budgetBand: budgetBand || null,
          availability: availability || null,
        }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-bids'] }),
  });
};

export const useSubmitBid = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<{ bid: Bid }>(`${api.baseUrl}/me/bids/${id}/submit`, {
        method: 'POST',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-bids'] }),
  });
};

/** The designer's own bids. 404 means they have no profile yet. */
export const useMyBids = () =>
  useQuery({
    queryKey: ['my-bids'],
    queryFn: () => request<{ bids: Bid[] }>(`${api.baseUrl}/me/bids`),
    retry: false,
  });
