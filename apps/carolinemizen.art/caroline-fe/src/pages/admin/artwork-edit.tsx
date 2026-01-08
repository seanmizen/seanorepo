import { type FC, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styled from 'styled-components';
import { Pagination } from '@/components';

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

const Select = styled.select`
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  background: white;

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

const PriceInputGroup = styled.div`
  display: flex;
  gap: 1rem;
`;

const PriceInput = styled(Input)`
  flex: 1;
`;

const CurrencySelect = styled(Select)`
  width: 120px;
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

interface ArtworkFormData {
  title: string;
  description: string;
  price_cents: number;
  currency: string;
  status: 'draft' | 'available' | 'sold';
  primary_image_id: number | null;
  image_ids: number[];
}

export const AdminArtworkEdit: FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [formData, setFormData] = useState<ArtworkFormData>({
    title: '',
    description: '',
    price_cents: 0,
    currency: 'GBP',
    status: 'draft',
    primary_image_id: null,
    image_ids: [],
  });

  const [priceDisplay, setPriceDisplay] = useState('0.00');
  const [images, setImages] = useState<Image[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const fetchArtwork = useCallback(async () => {
    if (isNew) return;

    try {
      const response = await fetch(`${API_URL}/admin/artworks/${id}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch artwork');
      }

      const data = await response.json();
      setFormData({
        title: data.artwork.title,
        description: data.artwork.description || '',
        price_cents: data.artwork.price_cents,
        currency: data.artwork.currency,
        status: data.artwork.status,
        primary_image_id: data.artwork.primary_image_id,
        image_ids: data.images.map((img: Image) => img.id),
      });
      setPriceDisplay((data.artwork.price_cents / 100).toFixed(2));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load artwork');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    fetchImages(page);
  }, [fetchImages, page]);

  useEffect(() => {
    fetchArtwork();
  }, [fetchArtwork]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const url = isNew
        ? `${API_URL}/admin/artworks`
        : `${API_URL}/admin/artworks/${id}`;

      const response = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to save artwork');
      }

      navigate('/admin/artworks');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save artwork');
    } finally {
      setSaving(false);
    }
  };

  const handleImageToggle = (imageId: number) => {
    setFormData((prev) => {
      const newImageIds = prev.image_ids.includes(imageId)
        ? prev.image_ids.filter((id) => id !== imageId)
        : [...prev.image_ids, imageId];

      return {
        ...prev,
        image_ids: newImageIds,
        primary_image_id:
          !prev.primary_image_id && newImageIds.length > 0
            ? newImageIds[0]
            : prev.primary_image_id,
      };
    });
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPriceDisplay(e.target.value);
  };

  const handlePriceBlur = () => {
    const value = Number.parseFloat(priceDisplay);
    if (!Number.isNaN(value) && value >= 0) {
      const cents = Math.round(value * 100);
      setFormData((prev) => ({ ...prev, price_cents: cents }));
      setPriceDisplay((cents / 100).toFixed(2));
    } else {
      setPriceDisplay((formData.price_cents / 100).toFixed(2));
    }
  };

  if (loading) {
    return <LoadingMessage>Loading...</LoadingMessage>;
  }

  return (
    <Container>
      <Header>
        <Title>{isNew ? 'Create Artwork' : 'Edit Artwork'}</Title>
        <Subtitle>
          {isNew
            ? 'Add a new artwork to your collection'
            : 'Update artwork details'}
        </Subtitle>
      </Header>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      <Form onSubmit={handleSubmit}>
        <FormSection>
          <Label htmlFor="title">Title *</Label>
          <Input
            id="title"
            type="text"
            value={formData.title}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, title: e.target.value }))
            }
            required
          />
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
          <Label htmlFor="price">Price *</Label>
          <PriceInputGroup>
            <PriceInput
              id="price"
              type="number"
              step="0.01"
              min="0"
              value={priceDisplay}
              onChange={handlePriceChange}
              onBlur={handlePriceBlur}
              required
            />
            <CurrencySelect
              value={formData.currency}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, currency: e.target.value }))
              }
            >
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </CurrencySelect>
          </PriceInputGroup>
        </FormSection>

        <FormSection>
          <Label htmlFor="status">Status *</Label>
          <Select
            id="status"
            value={formData.status}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                status: e.target.value as 'draft' | 'available' | 'sold',
              }))
            }
          >
            <option value="draft">Draft</option>
            <option value="available">Available</option>
            <option value="sold">Sold</option>
          </Select>
        </FormSection>

        <FormSection>
          <Label>Select Images</Label>
          <p
            style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}
          >
            Click images to add them to this artwork. The first selected image
            will be the primary image.
          </p>
          {images.length === 0 ? (
            <p style={{ color: '#999' }}>
              No images available. Upload images in the Images section first.
            </p>
          ) : (
            <>
              <ImageGrid>
                {images.map((image) => {
                  const isSelected = formData.image_ids.includes(image.id);
                  const isPrimary = formData.primary_image_id === image.id;

                  return (
                    <ImageCard
                      key={image.id}
                      selected={isSelected}
                      onClick={() => handleImageToggle(image.id)}
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
                      {isPrimary && <SelectedBadge>Primary</SelectedBadge>}
                      {isSelected && !isPrimary && (
                        <SelectedBadge>
                          {formData.image_ids.indexOf(image.id) + 1}
                        </SelectedBadge>
                      )}
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

        <ButtonRow>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/admin/artworks')}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : isNew ? 'Create Artwork' : 'Save Changes'}
          </Button>
        </ButtonRow>
      </Form>
    </Container>
  );
};
