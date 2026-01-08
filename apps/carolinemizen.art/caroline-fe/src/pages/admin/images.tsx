import { type FC, useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Pagination } from '@/components';
import { ImageUploader } from '@/components/image-uploader';

const Container = styled.div`
  max-width: 1200px;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
`;

const Title = styled.h1`
  margin: 0;
  color: #333;
`;

const Section = styled.section`
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  margin-bottom: 2rem;
`;

const SectionTitle = styled.h2`
  margin: 0 0 1.5rem;
  color: #2c3e50;
  font-size: 1.25rem;
`;

const ImageGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1.5rem;
`;

const ImageCard = styled.div`
  background: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
`;

const ImagePreview = styled.img`
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: #f5f5f5;
`;

const VideoPreview = styled.video`
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: #f5f5f5;
`;

const ImageInfo = styled.div`
  padding: 1rem;
`;

const ImageName = styled.div`
  font-size: 0.875rem;
  color: #333;
  margin-bottom: 0.5rem;
  word-break: break-all;
`;

const ImageMeta = styled.div`
  font-size: 0.75rem;
  color: #999;
  margin-bottom: 0.75rem;
`;

const DeleteButton = styled.button`
  width: 100%;
  padding: 0.5rem;
  background: #e74c3c;
  color: white;
  border: 2px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  position: relative;

  transition: box-shadow 120ms ease, transform 120ms ease,
    border-color 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }

  /* Override global focus - use border glow instead of underline */
  &:focus-visible::before,
  &:focus-visible::after {
    display: none;
  }

  &:focus-visible {
    border-color: var(--focus-flash);
    box-shadow: 0 0 0 3px
      color-mix(in srgb, var(--focus-flash) 40%, transparent);
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
  }
`;

const LoadingMessage = styled.div`
  text-align: center;
  padding: 2rem;
  color: #666;
`;

const ErrorMessage = styled.div`
  background: #f8d7da;
  color: #721c24;
  padding: 1rem;
  border-radius: 4px;
  margin-bottom: 1rem;
`;

const API_URL = import.meta.env.API_URL;

const getImageUrl = (storagePath: string) =>
  `${API_URL}/uploads/${storagePath}`;

interface Image {
  id: number;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  storage_path: string;
  created_at: string;
}

export const AdminImages: FC = () => {
  const [images, setImages] = useState<Image[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const fetchImages = useCallback(async (pageNum: number) => {
    try {
      const response = await fetch(
        `${API_URL}/admin/images?page=${pageNum}&limit=10`,
        {
          credentials: 'include',
        },
      );

      if (!response.ok) {
        throw new Error('Failed to fetch media');
      }

      const data = await response.json();
      setImages(data.images);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load media');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages(page);
  }, [fetchImages, page]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleUpload = useCallback(
    async (files: File[]) => {
      const formData = new FormData();
      for (const file of files) {
        formData.append('images', file);
      }

      const response = await fetch(`${API_URL}/admin/images/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload media');
      }

      setPage(1);
      await fetchImages(1);
    },
    [fetchImages],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm('Are you sure you want to delete this media?')) {
        return;
      }

      setDeleting(id);
      try {
        const response = await fetch(`${API_URL}/admin/images/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to delete media');
        }

        setPage(1);
        await fetchImages(1);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to delete media');
      } finally {
        setDeleting(null);
      }
    },
    [fetchImages],
  );

  const formatFileSize = (bytes: number): string => {
    const kb = bytes / 1024;
    if (kb < 1024) {
      return `${kb.toFixed(1)}KB`;
    }
    const mb = kb / 1024;
    return `${mb.toFixed(1)}MB`;
  };

  return (
    <Container>
      <Header>
        <Title>Media Library</Title>
      </Header>

      <Section>
        <SectionTitle>Upload Images & Videos</SectionTitle>
        <ImageUploader onUpload={handleUpload} />
      </Section>

      <Section>
        <SectionTitle>All Media</SectionTitle>

        {error && <ErrorMessage>{error}</ErrorMessage>}

        {loading ? (
          <LoadingMessage>Loading media...</LoadingMessage>
        ) : images.length === 0 ? (
          <LoadingMessage>No media uploaded yet</LoadingMessage>
        ) : (
          <>
            <ImageGrid>
              {images.map((image) => (
                <ImageCard key={image.id}>
                  {image.mime_type.startsWith('video/') ? (
                    <VideoPreview
                      src={getImageUrl(image.storage_path)}
                      controls
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <ImagePreview
                      src={getImageUrl(image.storage_path)}
                      alt={image.original_name}
                    />
                  )}
                  <ImageInfo>
                    <ImageName title={image.original_name}>
                      {image.original_name}
                    </ImageName>
                    <ImageMeta>
                      {image.width && image.height && (
                        <div>
                          {image.width} × {image.height}
                        </div>
                      )}
                      <div>{formatFileSize(image.file_size)}</div>
                    </ImageMeta>
                    <DeleteButton
                      type="button"
                      onClick={() => handleDelete(image.id)}
                      disabled={deleting === image.id}
                    >
                      {deleting === image.id ? 'Deleting...' : 'Delete'}
                    </DeleteButton>
                  </ImageInfo>
                </ImageCard>
              ))}
            </ImageGrid>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </Section>
    </Container>
  );
};
