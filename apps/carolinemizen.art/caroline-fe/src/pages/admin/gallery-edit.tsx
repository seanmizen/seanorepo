import { type FC, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styled from 'styled-components';
import { Pagination } from '@/components';
import type { Artwork } from '@/types';

const Container = styled.div`
  max-width: 900px;
`;

const Header = styled.div`
  margin-bottom: 2rem;
`;

const Title = styled.h1`
  margin: 0 0 0.5rem;
  color: #333;
`;

const Subtitle = styled.p`
  margin: 0;
  color: #666;
`;

const Form = styled.form`
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  padding: 2rem;
`;

const FormSection = styled.div`
  margin-bottom: 2rem;

  &:last-child {
    margin-bottom: 0;
  }
`;

const Label = styled.label`
  display: block;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: #333;
`;

const Input = styled.input`
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;

  &:focus {
    outline: none;
    border-color: #3498db;
  }
`;

const Textarea = styled.textarea`
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  min-height: 120px;
  resize: vertical;
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: #3498db;
  }
`;

const ImageGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
`;

const ImageCard = styled.div<{ selected: boolean }>`
  position: relative;
  aspect-ratio: 1;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  border: 3px solid ${(props) => (props.selected ? '#3498db' : '#e0e0e0')};
  transition: all 0.2s;

  &:hover {
    border-color: #3498db;
  }
`;

const ImagePreview = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const VideoPreview = styled.video`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const SelectedBadge = styled.div`
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: #3498db;
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 2rem;
`;

const Button = styled.button<{ variant?: 'primary' | 'secondary' }>`
  padding: 0.75rem 2rem;
  border: 2px solid transparent;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  background: ${(props) =>
    props.variant === 'secondary' ? '#95a5a6' : '#3498db'};
  color: white;

  transition: box-shadow 120ms ease, transform 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
  }
`;

const ErrorMessage = styled.div`
  background: #f8d7da;
  color: #721c24;
  padding: 1rem;
  border-radius: 4px;
  margin-bottom: 1rem;
`;

const LoadingMessage = styled.div`
  text-align: center;
  padding: 3rem;
  color: #666;
`;

const HelpText = styled.p`
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  color: #666;
`;

const Table = styled.table`
  width: 100%;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  border-collapse: collapse;
  overflow: hidden;
  margin-top: 1rem;
`;

const Th = styled.th`
  text-align: left;
  padding: 1rem;
  background: #f5f5f5;
  font-weight: 600;
  color: #555;
  border-bottom: 2px solid #e0e0e0;
`;

const Td = styled.td`
  padding: 1rem;
  border-bottom: 1px solid #f0f0f0;
`;

const Tr = styled.tr`
  &:hover {
    background: #fafafa;
  }

  &:last-child td {
    border-bottom: none;
  }
`;

const ArtworkImage = styled.img`
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 4px;
  background: #f5f5f5;
`;

const ArtworkVideo = styled.video`
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 4px;
  background: #f5f5f5;
`;

const StatusBadge = styled.span<{ status: string }>`
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  background: ${(props) => {
    switch (props.status) {
      case 'available':
        return '#d4edda';
      case 'sold':
        return '#f8d7da';
      default:
        return '#fff3cd';
    }
  }};
  color: ${(props) => {
    switch (props.status) {
      case 'available':
        return '#155724';
      case 'sold':
        return '#721c24';
      default:
        return '#856404';
    }
  }};
`;

const API_URL = import.meta.env.API_URL;

const getImageUrl = (storagePath: string) =>
  `${API_URL}/uploads/${storagePath}`;

interface Image {
  id: number;
  filename: string;
  original_name: string;
  mime_type: string;
  storage_path: string;
}

interface GalleryFormData {
  name: string;
  slug: string;
  description: string;
  cover_image_id: number | null;
  artwork_ids: number[];
}

export const AdminGalleryEdit: FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [formData, setFormData] = useState<GalleryFormData>({
    name: '',
    slug: '',
    description: '',
    cover_image_id: null,
    artwork_ids: [],
  });

  const [images, setImages] = useState<Image[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artworks, setArtworks] = useState<Artwork[]>([]);

  const fetchArtworks = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/admin/artworks`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch artworks');
      }

      const data = await response.json();
      setArtworks(data.artworks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load artworks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArtworks();
  }, [fetchArtworks]);

  const fetchImages = useCallback(async (pageNum: number) => {
    try {
      const response = await fetch(
        `${API_URL}/admin/images?page=${pageNum}&limit=10`,
        {
          credentials: 'include',
        },
      );

      if (response.ok) {
        const data = await response.json();
        setImages(data.images);
        setTotalPages(data.pagination.totalPages);
      }
    } catch (err) {
      console.error('Failed to load images:', err);
    }
  }, []);

  const fetchGallery = useCallback(async () => {
    if (isNew) return;

    try {
      const response = await fetch(`${API_URL}/admin/galleries/${id}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch collection');
      }

      const data = await response.json();
      const galleryArtworkIds = data.artworks.map((a: Artwork) => a.id);

      setFormData({
        name: data.gallery.name,
        slug: data.gallery.slug,
        description: data.gallery.description || '',
        cover_image_id: data.gallery.cover_image_id,
        artwork_ids: galleryArtworkIds,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load collection',
      );
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    fetchImages(page);
  }, [fetchImages, page]);

  useEffect(() => {
    fetchGallery();
  }, [fetchGallery]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (isNew) {
        const response = await fetch(`${API_URL}/admin/galleries`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (!response.ok) {
          throw new Error('Failed to create collection');
        }
      } else {
        const { artwork_ids, ...galleryData } = formData;

        const galleryResponse = await fetch(
          `${API_URL}/admin/galleries/${id}`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(galleryData),
          },
        );

        if (!galleryResponse.ok) {
          throw new Error('Failed to update collection');
        }

        const artworksResponse = await fetch(
          `${API_URL}/admin/galleries/${id}/artworks`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artwork_ids }),
          },
        );

        if (!artworksResponse.ok) {
          throw new Error('Failed to update collection artworks');
        }
      }

      navigate('/admin/collections');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save collection',
      );
    } finally {
      setSaving(false);
    }
  };

  const generateSlug = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setFormData((prev) => ({ ...prev, name: newName }));
  };

  const handleImageSelect = (imageId: number) => {
    setFormData((prev) => ({
      ...prev,
      cover_image_id: prev.cover_image_id === imageId ? null : imageId,
    }));
  };

  const handleArtworkToggle = (artworkId: number) => {
    setFormData((prev) => ({
      ...prev,
      artwork_ids: prev.artwork_ids.includes(artworkId)
        ? prev.artwork_ids.filter((id) => id !== artworkId)
        : [...prev.artwork_ids, artworkId],
    }));
  };

  const formatPrice = (cents: number, currency: string): string => {
    const amount = cents / 100;
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  if (loading) {
    return <LoadingMessage>Loading...</LoadingMessage>;
  }

  return (
    <Container>
      <Header>
        <Title>{isNew ? 'Create Collection' : 'Edit Collection'}</Title>
        <Subtitle>
          {isNew
            ? 'Create a new collection to organize your artworks'
            : 'Update collection details'}
        </Subtitle>
      </Header>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      <Form onSubmit={handleSubmit}>
        <FormSection>
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            type="text"
            value={formData.name}
            onChange={handleNameChange}
            required
          />
        </FormSection>

        <FormSection>
          <Label htmlFor="slug">URL Slug</Label>
          <Input
            id="slug"
            type="text"
            value={formData.slug}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, slug: e.target.value }))
            }
            placeholder={generateSlug(formData.name) || 'auto-generated-slug'}
            pattern="[a-z0-9-]+"
            title="Lowercase letters, numbers, and hyphens only"
          />
          <HelpText>
            Optional. Leave empty to auto-generate from name (e.g., &quot;Summer
            2024&quot; → &quot;summer-2024&quot;)
          </HelpText>
        </FormSection>

        <FormSection>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, description: e.target.value }))
            }
          />
        </FormSection>

        <FormSection>
          <Label>Cover Image (Optional)</Label>
          <p
            style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}
          >
            Click an image to set it as the collection cover
          </p>
          {images.length === 0 ? (
            <p style={{ color: '#999' }}>
              No images available. Upload images in the Images section first.
            </p>
          ) : (
            <>
              <ImageGrid>
                {images.map((image) => {
                  const isSelected = formData.cover_image_id === image.id;

                  return (
                    <ImageCard
                      key={image.id}
                      selected={isSelected}
                      onClick={() => handleImageSelect(image.id)}
                    >
                      {image.mime_type.startsWith('video/') ? (
                        <VideoPreview
                          src={getImageUrl(image.storage_path)}
                          loop
                          autoPlay
                          muted
                          playsInline
                        />
                      ) : (
                        <ImagePreview
                          src={getImageUrl(image.storage_path)}
                          alt={image.original_name}
                        />
                      )}
                      {isSelected && <SelectedBadge>Cover</SelectedBadge>}
                    </ImageCard>
                  );
                })}
              </ImageGrid>
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            </>
          )}
        </FormSection>

        <FormSection>
          <Label>Add Artworks to Collection</Label>
          <HelpText>
            Select artworks to include in this collection. Selected artworks
            will appear in the public collection view.
          </HelpText>
          {artworks.length === 0 ? (
            <p style={{ color: '#999', marginTop: '1rem' }}>
              No artworks available. Create artworks first in the Artworks
              section.
            </p>
          ) : (
            <Table>
              <thead>
                <Tr>
                  <Th style={{ width: '50px' }}>
                    <input
                      type="checkbox"
                      checked={
                        artworks.length > 0 &&
                        formData.artwork_ids.length === artworks.length
                      }
                      onChange={() => {
                        setFormData((prev) => ({
                          ...prev,
                          artwork_ids:
                            prev.artwork_ids.length === artworks.length
                              ? []
                              : artworks.map((a) => a.id),
                        }));
                      }}
                    />
                  </Th>
                  <Th>Image</Th>
                  <Th>Title</Th>
                  <Th>Price</Th>
                  <Th>Status</Th>
                </Tr>
              </thead>
              <tbody>
                {artworks.map((artwork) => (
                  <Tr key={artwork.id}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={formData.artwork_ids.includes(artwork.id)}
                        onChange={() => handleArtworkToggle(artwork.id)}
                      />
                    </Td>
                    <Td>
                      {artwork.primary_image_path ? (
                        artwork.primary_image_mime_type?.startsWith(
                          'video/',
                        ) ? (
                          <ArtworkVideo
                            src={`${API_URL}/uploads/${artwork.primary_image_path}`}
                            loop
                            autoPlay
                            muted
                            playsInline
                          />
                        ) : (
                          <ArtworkImage
                            src={`${API_URL}/uploads/${artwork.primary_image_path}`}
                            alt={artwork.title}
                          />
                        )
                      ) : (
                        <div
                          style={{
                            width: '60px',
                            height: '60px',
                            background: '#f0f0f0',
                            borderRadius: '4px',
                          }}
                        />
                      )}
                    </Td>
                    <Td>
                      <strong>{artwork.title}</strong>
                      {artwork.description && (
                        <div
                          style={{
                            fontSize: '0.875rem',
                            color: '#666',
                            marginTop: '0.25rem',
                          }}
                        >
                          {artwork.description.substring(0, 100)}
                          {artwork.description.length > 100 ? '...' : ''}
                        </div>
                      )}
                    </Td>
                    <Td>
                      {formatPrice(artwork.price_cents, artwork.currency)}
                    </Td>
                    <Td>
                      <StatusBadge status={artwork.status}>
                        {artwork.status}
                      </StatusBadge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </FormSection>
        <ButtonRow>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/admin/collections')}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? 'Saving...'
              : isNew
                ? 'Create Collection'
                : 'Save Changes'}
          </Button>
        </ButtonRow>
      </Form>
    </Container>
  );
};
