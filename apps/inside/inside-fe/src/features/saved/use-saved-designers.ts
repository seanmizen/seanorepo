import type { SavedDesignerListResponse } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/config';
import { ApiError, get, send } from '@/lib/http';

/**
 * The buyer's shortlist: saving, unsaving, and reading it back.
 *
 * `saved-designer` (singular) is the per-designer membership check the save
 * control uses. `saved-designers` (plural) is the shortlist page. A mutation
 * invalidates both, so a save made from a profile page is reflected on the
 * shortlist without a manual refresh, and vice versa.
 */

export { ApiError };

export const useSavedDesigners = (page: number) =>
  useQuery({
    queryKey: ['saved-designers', page],
    queryFn: () =>
      get<SavedDesignerListResponse>(
        `${api.endpoints.savedDesigners}?page=${page}`,
      ),
    retry: false,
  });

/**
 * Whether ONE designer is on the signed-in buyer's shortlist.
 *
 * `enabled` is the caller's: an anonymous visitor has no shortlist to check,
 * and firing this against a 401 would just be the button's own state query
 * triggering REQ-AUTH-008's sign-out handling for no reason.
 */
export const useIsSaved = (designerProfileId: number, enabled: boolean) =>
  useQuery({
    queryKey: ['saved-designer', designerProfileId],
    queryFn: () =>
      get<{ saved: boolean }>(
        `${api.endpoints.savedDesigners}/${designerProfileId}`,
      ),
    enabled,
    retry: false,
  });

const invalidateSaved = (
  client: ReturnType<typeof useQueryClient>,
  designerProfileId: number,
) => {
  client.invalidateQueries({ queryKey: ['saved-designer', designerProfileId] });
  client.invalidateQueries({ queryKey: ['saved-designers'] });
};

export const useSaveDesigner = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (designerProfileId: number) =>
      send<{ saved: true }>(
        `${api.endpoints.savedDesigners}/${designerProfileId}`,
        'POST',
      ),
    onSuccess: (_data, designerProfileId) =>
      invalidateSaved(client, designerProfileId),
  });
};

export const useUnsaveDesigner = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (designerProfileId: number) =>
      send<{ saved: false }>(
        `${api.endpoints.savedDesigners}/${designerProfileId}`,
        'DELETE',
      ),
    onSuccess: (_data, designerProfileId) =>
      invalidateSaved(client, designerProfileId),
  });
};
