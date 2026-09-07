import type {
  DesignerProfile,
  PortfolioProject,
  PortfolioProjectImage,
  StoredImage,
} from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/config';
import { ApiError, request } from '@/lib/http';

/**
 * The designer's own view of their studio: the draft profile, its portfolio,
 * and the uploads behind both.
 *
 * Everything here is `/me/*` — owner-scoped and behind a session. The public
 * read side lives in `features/discovery` and shares nothing with it on
 * purpose: what a designer may see of their own work (drafts included) and
 * what the world may see (REQ-DISCOVERY-002) are different questions.
 */

/** Re-exported so pages keep one import for the studio surface. */
export { ApiError };

export interface MyProfileResponse {
  profile: DesignerProfile | null;
}

export interface MyProjectResponse {
  project: PortfolioProject;
  images: Array<PortfolioProjectImage & { image: StoredImage }>;
}

/**
 * The signed-in designer's profile, or null when they have not started one.
 *
 * `null` is a real answer here, not an error — a designer who has just signed
 * up has no profile, and that is the normal first visit rather than a failure
 * (the same shape as REQ-AUTH-005).
 */
export const useMyProfile = () =>
  useQuery({
    queryKey: ['my-profile'],
    queryFn: () => request<MyProfileResponse>(api.endpoints.myProfile),
    retry: false,
  });

export const useMyPortfolio = () =>
  useQuery({
    queryKey: ['my-portfolio'],
    queryFn: () =>
      request<{ portfolioProjects: PortfolioProject[] }>(
        api.endpoints.myPortfolio,
      ),
    retry: false,
  });

export const useMyProject = (id: number | null) =>
  useQuery({
    queryKey: ['my-project', id],
    queryFn: () =>
      request<MyProjectResponse>(`${api.endpoints.myPortfolio}/${id}`),
    enabled: id !== null,
    retry: false,
  });

/** Creates the profile on first save, updates it on every save after. */
export const useSaveProfile = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      exists,
      fields,
    }: {
      exists: boolean;
      fields: Record<string, unknown>;
    }) =>
      request<{ profile: DesignerProfile }>(api.endpoints.myProfile, {
        method: exists ? 'PUT' : 'POST',
        body: JSON.stringify(fields),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-profile'] }),
  });
};

export const useSubmitProfile = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ profile: DesignerProfile }>(
        `${api.endpoints.myProfile}/submit`,
        { method: 'POST' },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-profile'] }),
  });
};

export const useSaveProject = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      fields,
    }: {
      id: number | null;
      fields: Record<string, unknown>;
    }) =>
      request<{ project: PortfolioProject }>(
        id === null
          ? api.endpoints.myPortfolio
          : `${api.endpoints.myPortfolio}/${id}`,
        { method: id === null ? 'POST' : 'PUT', body: JSON.stringify(fields) },
      ),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ['my-portfolio'] });
      client.invalidateQueries({ queryKey: ['my-project', variables.id] });
    },
  });
};

export const useDeleteProject = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<{ ok: true }>(`${api.endpoints.myPortfolio}/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-portfolio'] }),
  });
};

/** Persists the curatorial order of a piece's images. */
export const useSaveProjectImages = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      images,
    }: {
      id: number;
      images: Array<{ imageId: number; caption: string | null }>;
    }) =>
      request<MyProjectResponse>(`${api.endpoints.myPortfolio}/${id}/images`, {
        method: 'PUT',
        body: JSON.stringify({ images }),
      }),
    onSuccess: (_data, variables) =>
      client.invalidateQueries({ queryKey: ['my-project', variables.id] }),
  });
};

export interface UploadProgress {
  /** 0–1, or null while the browser has not reported any progress yet. */
  fraction: number | null;
}

/**
 * Upload one image, reporting progress as it goes.
 *
 * `XMLHttpRequest` rather than `fetch`, for the one reason that matters here:
 * fetch cannot report upload progress. A designer on a phone uploading a 6MB
 * photograph gets a bar that moves instead of a page that appears to have
 * hung, which is the difference between waiting and giving up.
 */
export function uploadImage(
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<StoredImage> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', api.endpoints.myImages);
    xhr.withCredentials = true;
    /*
     * REQ-NET-002. Longer than the shared deadline because this is the one
     * request that legitimately takes minutes — a 50MB photograph over mobile
     * — but not unbounded, which is what it was.
     */
    xhr.timeout = 5 * 60 * 1000;

    xhr.upload.addEventListener('progress', (event) => {
      onProgress({
        fraction: event.lengthComputable ? event.loaded / event.total : null,
      });
    });

    xhr.addEventListener('load', () => {
      let body: { image?: StoredImage; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Falls through to the status-derived message below.
      }

      if (xhr.status >= 200 && xhr.status < 300 && body.image) {
        resolve(body.image);
        return;
      }
      reject(
        new ApiError(
          body.error ?? `Upload failed (${xhr.status}).`,
          xhr.status,
        ),
      );
    });

    xhr.addEventListener('error', () =>
      reject(
        new ApiError('The upload could not reach the server.', 0, 'network'),
      ),
    );
    xhr.addEventListener('abort', () =>
      reject(new ApiError('The upload was cancelled.', 0, 'network')),
    );
    xhr.addEventListener('timeout', () =>
      reject(new ApiError('That upload took too long.', 0, 'timeout')),
    );

    xhr.send(form);
  });
}
