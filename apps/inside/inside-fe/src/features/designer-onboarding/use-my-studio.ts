import type {
  DesignerProfile,
  PortfolioProject,
  PortfolioProjectImage,
  StoredImage,
} from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/config';

/**
 * The designer's own view of their studio: the draft profile, its portfolio,
 * and the uploads behind both.
 *
 * Everything here is `/me/*` — owner-scoped and behind a session. The public
 * read side lives in `features/discovery` and shares nothing with it on
 * purpose: what a designer may see of their own work (drafts included) and
 * what the world may see (REQ-DISCOVERY-002) are different questions.
 */

/** A server error carrying the message the API chose, not a generic one. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });

  if (!response.ok) {
    // The server's own wording is shown to the designer wherever it has any:
    // "That file is 14MB; the limit is 8MB" beats "Request failed", and it is
    // the only message that says what to do next.
    let message = `Something went wrong (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error.length > 0) {
        message = body.error;
      }
    } catch {
      // A non-JSON error body is not itself an error worth surfacing.
    }
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

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
      reject(new ApiError('The upload could not reach the server.', 0)),
    );
    xhr.addEventListener('abort', () =>
      reject(new ApiError('The upload was cancelled.', 0)),
    );

    xhr.send(form);
  });
}
