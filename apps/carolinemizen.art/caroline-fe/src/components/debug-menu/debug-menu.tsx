import { type FC, useState } from 'react';
import styled from 'styled-components';

const API_URL = import.meta.env.API_URL;
const DEBUG_MODE = import.meta.env.DEBUG_MODE === 'true';

const DebugButton = styled.button`
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: #ff6b6b;
  color: white;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: all 0.2s;
  z-index: 9999;

  &:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  }
`;

const MenuPanel = styled.div<{ $isOpen: boolean }>`
  position: fixed;
  bottom: 80px;
  right: 20px;
  width: 350px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 1.5rem;
  z-index: 9999;
  transform: ${(props) => (props.$isOpen ? 'scale(1)' : 'scale(0)')};
  transform-origin: bottom right;
  transition: transform 0.2s;
  opacity: ${(props) => (props.$isOpen ? '1' : '0')};
  pointer-events: ${(props) => (props.$isOpen ? 'auto' : 'none')};
`;

const MenuTitle = styled.h3`
  margin: 0 0 1rem;
  color: #333;
  font-size: 1.125rem;
  border-bottom: 2px solid #ff6b6b;
  padding-bottom: 0.5rem;
`;

const Section = styled.div`
  margin-bottom: 1.5rem;

  &:last-child {
    margin-bottom: 0;
  }
`;

const SectionTitle = styled.h4`
  margin: 0 0 0.75rem;
  color: #555;
  font-size: 0.9375rem;
  font-weight: 600;
`;

const InputGroup = styled.div`
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
`;

const Label = styled.label`
  flex: 1;
  font-size: 0.875rem;
  color: #666;
  display: flex;
  align-items: center;
`;

const Input = styled.input`
  width: 80px;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;

  &:focus {
    outline: none;
    border-color: #ff6b6b;
  }
`;

const GenerateButton = styled.button`
  width: 100%;
  padding: 0.75rem;
  background: #ff6b6b;
  color: white;
  border: none;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: #ee5a52;
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
`;

const StatusMessage = styled.div<{ $type: 'success' | 'error' }>`
  margin-top: 1rem;
  padding: 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;
  background: ${(props) => (props.$type === 'success' ? '#d4edda' : '#f8d7da')};
  color: ${(props) => (props.$type === 'success' ? '#155724' : '#721c24')};
  border: 1px solid
    ${(props) => (props.$type === 'success' ? '#c3e6cb' : '#f5c6cb')};
`;

export const DebugMenu: FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [artworkCount, setArtworkCount] = useState(10);
  const [galleryCount, setGalleryCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  if (!DEBUG_MODE) {
    return null;
  }

  const handleGenerate = async () => {
    setLoading(true);
    setStatus(null);

    try {
      const response = await fetch(
        `${API_URL}/admin/debug/generate-sample-data`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            artworkCount,
            galleryCount,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate sample data');
      }

      const result = await response.json();
      setStatus({
        type: 'success',
        message: `Generated ${result.artworksCreated} artworks and ${result.galleriesCreated} galleries!`,
      });
    } catch (error) {
      setStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to generate data',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <DebugButton type="button" onClick={() => setIsOpen(!isOpen)}>
        🔧
      </DebugButton>
      <MenuPanel $isOpen={isOpen}>
        <MenuTitle>Debug Menu</MenuTitle>

        <Section>
          <SectionTitle>Generate Sample Data</SectionTitle>

          <InputGroup>
            <Label>
              Artworks:
              <Input
                type="number"
                min="1"
                max="100"
                value={artworkCount}
                onChange={(e) => setArtworkCount(Number(e.target.value))}
              />
            </Label>
          </InputGroup>

          <InputGroup>
            <Label>
              Galleries:
              <Input
                type="number"
                min="1"
                max="20"
                value={galleryCount}
                onChange={(e) => setGalleryCount(Number(e.target.value))}
              />
            </Label>
          </InputGroup>

          <GenerateButton
            type="button"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? 'Generating...' : 'Generate Sample Data'}
          </GenerateButton>

          {status && (
            <StatusMessage $type={status.type}>{status.message}</StatusMessage>
          )}
        </Section>
      </MenuPanel>
    </>
  );
};
