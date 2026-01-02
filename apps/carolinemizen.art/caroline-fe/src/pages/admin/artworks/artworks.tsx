import { type FC, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import type { Artwork } from '@/types';
import { ArtworksTable } from './artworks-table';

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

const API_URL = import.meta.env.API_URL;

const Artworks: FC = () => {
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

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

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm('Are you sure you want to delete this artwork?')) {
        return;
      }

      setDeleting(id);
      try {
        const response = await fetch(`${API_URL}/admin/artworks/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to delete artwork');
        }

        await fetchArtworks();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to delete artwork');
      } finally {
        setDeleting(null);
      }
    },
    [fetchArtworks],
  );

  const handleStatusChange = useCallback(
    async (id: number, status: 'draft' | 'available' | 'sold') => {
      try {
        const response = await fetch(`${API_URL}/admin/artworks/${id}/status`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });

        if (!response.ok) {
          throw new Error('Failed to update status');
        }

        // Update local state optimistically
        setArtworks((prev) =>
          prev.map((artwork) =>
            artwork.id === id ? { ...artwork, status } : artwork,
          ),
        );
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to update status');
        // Refetch to revert optimistic update
        await fetchArtworks();
      }
    },
    [fetchArtworks],
  );

  const formatPrice = (cents: number, currency: string): string => {
    const amount = cents / 100;
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  if (loading) {
    return <LoadingMessage>Loading artworks...</LoadingMessage>;
  }

  return (
    <Container>
      <Header>
        <Title>Artworks</Title>
        <CreateButton to="/admin/artworks/new">Create Artwork</CreateButton>
      </Header>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {artworks.length === 0 ? (
        <EmptyState>
          <h2>No Artworks Yet</h2>
          <p>Create your first artwork to get started.</p>
          <CreateButton to="/admin/artworks/new">Create Artwork</CreateButton>
        </EmptyState>
      ) : (
        <ArtworksTable
          artworks={artworks}
          deleting={deleting}
          handleDelete={handleDelete}
          handleStatusChange={handleStatusChange}
          formatPrice={formatPrice}
        />
      )}
    </Container>
  );
};

export { Artworks };
