import { type FC, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';

const Container = styled.div`
  max-width: 1400px;
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

const CreateButton = styled(Link)`
  padding: 0.75rem 2rem;
  background: #3498db;
  color: white;
  border-radius: 10px;
  border: 2px solid transparent;
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 600;
  display: inline-block;
  cursor: pointer;
  position: relative;

  transition:
    box-shadow 120ms ease,
    transform 120ms ease,
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
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus-flash) 40%, transparent);
  }
`;

const Table = styled.table`
  width: 100%;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  border-collapse: collapse;
`;

const Th = styled.th`
  padding: 1rem;
  text-align: left;
  border-bottom: 2px solid #e0e0e0;
  color: #555;
  font-weight: 600;
`;

const Td = styled.td`
  padding: 1rem;
  border-bottom: 1px solid #f0f0f0;
`;

const Tr = styled.tr`
  &:hover {
    background: #f9f9f9;
  }

  &:last-child td {
    border-bottom: none;
  }
`;

const GalleryImage = styled.img`
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 4px;
  background: #f5f5f5;
`;

const GalleryVideo = styled.video`
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 4px;
  background: #f5f5f5;
`;

const ActionButtons = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const EditButton = styled(Link)`
  padding: 0.5rem 1rem;
  background: #3498db;
  color: white;
  border-radius: 10px;
  border: 2px solid transparent;
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 600;
  display: inline-block;
  cursor: pointer;
  position: relative;

  transition:
    box-shadow 120ms ease,
    transform 120ms ease,
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
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus-flash) 40%, transparent);
  }
`;

const DeleteButton = styled.button`
  padding: 0.5rem 1rem;
  background: #e74c3c;
  color: white;
  border: 2px solid transparent;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  position: relative;

  transition:
    box-shadow 120ms ease,
    transform 120ms ease,
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
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus-flash) 40%, transparent);
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
  padding: 3rem;
  color: #666;
`;

const ErrorMessage = styled.div`
  background: #f8d7da;
  color: #721c24;
  padding: 1rem;
  border-radius: 4px;
  margin-bottom: 1rem;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 4rem 2rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  h2 {
    margin: 0 0 1rem;
    color: #333;
  }

  p {
    margin: 0 0 2rem;
    color: #666;
  }
`;

const SlugCell = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const SlugCode = styled.code`
  background: #f0f0f0;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  flex: 1;
`;

const IconButton = styled.button`
  background: transparent;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: #3498db;
  font-size: 1.125rem;
  line-height: 1;
  transition: color 0.2s;

  &:hover {
    color: #2980b9;
  }

  &:active {
    color: #1a5c8a;
  }
`;

const API_URL = import.meta.env.API_URL;
const PUBLIC_URL = import.meta.env.PUBLIC_URL || 'http://localhost:4020';

interface Gallery {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_image_id: number | null;
  cover_image_path: string | null;
  cover_image_mime_type: string | null;
  is_featured: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export const AdminGalleries: FC = () => {
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const fetchGalleries = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/admin/galleries`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch galleries');
      }

      const data = await response.json();
      setGalleries(data.galleries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load galleries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGalleries();
  }, [fetchGalleries]);

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm('Are you sure you want to delete this gallery?')) {
        return;
      }

      setDeleting(id);
      try {
        const response = await fetch(`${API_URL}/admin/galleries/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to delete gallery');
        }

        await fetchGalleries();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to delete gallery');
      } finally {
        setDeleting(null);
      }
    },
    [fetchGalleries],
  );

  const handleCopyLink = useCallback((slug: string) => {
    const url = `${PUBLIC_URL}/collections/${slug}`;
    navigator.clipboard.writeText(url).then(
      () => {
        // alert('Link copied to clipboard!');
      },
      (err) => {
        console.error('Failed to copy:', err);
        alert('Failed to copy link');
      },
    );
  }, []);

  const handleFollowLink = useCallback((slug: string) => {
    const url = `${PUBLIC_URL}/collections/${slug}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const handleMoveUp = useCallback(
    async (id: number) => {
      try {
        const response = await fetch(
          `${API_URL}/admin/galleries/${id}/move-up`,
          {
            method: 'POST',
            credentials: 'include',
          },
        );

        if (!response.ok) {
          throw new Error('Failed to reorder gallery');
        }

        await fetchGalleries();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to reorder gallery');
      }
    },
    [fetchGalleries],
  );

  const handleMoveDown = useCallback(
    async (id: number) => {
      try {
        const response = await fetch(
          `${API_URL}/admin/galleries/${id}/move-down`,
          {
            method: 'POST',
            credentials: 'include',
          },
        );

        if (!response.ok) {
          throw new Error('Failed to reorder gallery');
        }

        await fetchGalleries();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to reorder gallery');
      }
    },
    [fetchGalleries],
  );

  if (loading) {
    return (
      <Container>
        <Header>
          <Title>Galleries</Title>
        </Header>
        <LoadingMessage>Loading galleries...</LoadingMessage>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <Title>Galleries</Title>
        <CreateButton to="/admin/galleries/new">Create Gallery</CreateButton>
      </Header>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {galleries.length === 0 ? (
        <EmptyState>
          <h2>No galleries yet</h2>
          <p>Create your first gallery to organize your artworks</p>
          <CreateButton to="/admin/galleries/new">Create Gallery</CreateButton>
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Cover</Th>
              <Th>Name</Th>
              <Th>Slug</Th>
              <Th>Order</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {galleries.map((gallery) => (
              <Tr key={gallery.id}>
                <Td>
                  {gallery.cover_image_path ? (
                    gallery.cover_image_mime_type?.startsWith('video/') ? (
                      <GalleryVideo
                        src={`${API_URL}/uploads/${gallery.cover_image_path}`}
                        loop
                        autoPlay
                        muted
                        playsInline
                      />
                    ) : (
                      <GalleryImage
                        src={`${API_URL}/uploads/${gallery.cover_image_path}`}
                        alt={gallery.name}
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
                  <strong>{gallery.name}</strong>
                  {gallery.description && (
                    <div
                      style={{
                        fontSize: '0.875rem',
                        color: '#666',
                        marginTop: '0.25rem',
                      }}
                    >
                      {gallery.description}
                    </div>
                  )}
                </Td>
                <Td>
                  <SlugCell>
                    <SlugCode>/{gallery.slug}</SlugCode>
                    <IconButton
                      type="button"
                      onClick={() => handleCopyLink(gallery.slug)}
                      title="Copy link to clipboard"
                    >
                      📋
                    </IconButton>
                    <IconButton
                      type="button"
                      onClick={() => handleFollowLink(gallery.slug)}
                      title="Open in new tab"
                    >
                      🔗
                    </IconButton>
                  </SlugCell>
                </Td>
                <Td>
                  <ActionButtons>
                    <IconButton
                      type="button"
                      onClick={() => handleMoveUp(gallery.id)}
                      disabled={gallery.display_order === 0}
                      title="Move up"
                    >
                      ↑
                    </IconButton>
                    <span>{gallery.display_order + 1}</span>
                    <IconButton
                      type="button"
                      onClick={() => handleMoveDown(gallery.id)}
                      disabled={gallery.display_order === galleries.length - 1}
                      title="Move down"
                    >
                      ↓
                    </IconButton>
                  </ActionButtons>
                </Td>
                <Td>
                  <ActionButtons>
                    <EditButton to={`/admin/galleries/${gallery.id}`}>
                      Edit
                    </EditButton>
                    <DeleteButton
                      type="button"
                      onClick={() => handleDelete(gallery.id)}
                      disabled={deleting === gallery.id}
                    >
                      {deleting === gallery.id ? 'Deleting...' : 'Delete'}
                    </DeleteButton>
                  </ActionButtons>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Container>
  );
};
