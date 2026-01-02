import type { FC } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import type { Artwork } from '@/types';

const Table = styled.table`
  width: 100%;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  border-collapse: collapse;
  overflow: hidden;
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

const StatusSelect = styled.select<{ $status: string }>`
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  border: 2px solid;
  cursor: pointer;
  position: relative;
  background: ${(props) => {
    switch (props.$status) {
      case 'available':
        return '#d4edda';
      case 'sold':
        return '#f8d7da';
      default:
        return '#fff3cd';
    }
  }};
  color: ${(props) => {
    switch (props.$status) {
      case 'available':
        return '#155724';
      case 'sold':
        return '#721c24';
      default:
        return '#856404';
    }
  }};
  border-color: ${(props) => {
    switch (props.$status) {
      case 'available':
        return '#c3e6cb';
      case 'sold':
        return '#f5c6cb';
      default:
        return '#ffeaa7';
    }
  }};

  transition:
    box-shadow 120ms ease,
    transform 120ms ease,
    border-color 120ms ease,
    opacity 120ms ease;

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

const API_URL = import.meta.env.API_URL;

interface Props {
  artworks: Artwork[];
  deleting: number | null;
  handleDelete: (id: number) => void;
  handleStatusChange: (
    id: number,
    status: 'draft' | 'available' | 'sold',
  ) => void;
  formatPrice: (cents: number, currency: string) => string;
}

const ArtworksTable: FC<Props> = ({
  artworks,
  deleting,
  handleDelete,
  handleStatusChange,
  formatPrice,
}) => {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Image</Th>
          <Th>Title</Th>
          <Th>Price</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </tr>
      </thead>
      <tbody>
        {artworks.map((artwork) => (
          <Tr key={artwork.id}>
            <Td>
              {artwork.primary_image_path ? (
                artwork.primary_image_mime_type?.startsWith('video/') ? (
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
            <Td>{formatPrice(artwork.price_cents, artwork.currency)}</Td>
            <Td>
              <StatusSelect
                $status={artwork.status}
                value={artwork.status}
                onChange={(e) =>
                  handleStatusChange(
                    artwork.id,
                    e.target.value as 'draft' | 'available' | 'sold',
                  )
                }
              >
                <option value="draft">Draft</option>
                <option value="available">Available</option>
                <option value="sold">Sold</option>
              </StatusSelect>
            </Td>
            <Td>
              <ActionButtons>
                <EditButton to={`/admin/artworks/${artwork.id}`}>
                  Edit
                </EditButton>
                <DeleteButton
                  type="button"
                  onClick={() => handleDelete(artwork.id)}
                  disabled={deleting === artwork.id}
                >
                  {deleting === artwork.id ? 'Deleting...' : 'Delete'}
                </DeleteButton>
              </ActionButtons>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
};

export { ArtworksTable };
