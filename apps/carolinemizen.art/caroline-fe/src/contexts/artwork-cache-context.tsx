import {
  createContext,
  type FC,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { Artwork } from '@/types';

export interface Gallery {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_image_path: string | null;
  cover_image_mime_type: string | null;
}

const API_URL = import.meta.env.API_URL;

interface ArtworkCacheContextValue {
  artworks: Artwork[];
  galleries: Gallery[];
  loading: boolean;
}

const ArtworkCacheContext = createContext<ArtworkCacheContextValue | null>(
  null,
);

export const ArtworkCacheProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [artworksRes, galleriesRes] = await Promise.all([
          fetch(`${API_URL}/artworks`),
          fetch(`${API_URL}/galleries`),
        ]);

        if (artworksRes.ok) {
          const data = await artworksRes.json();
          const nonDraft = data.artworks.filter(
            (a: Artwork) => a.status !== 'draft' && a.primary_image_path,
          );
          setArtworks(nonDraft);
        }

        if (galleriesRes.ok) {
          const data = await galleriesRes.json();
          setGalleries(data.galleries.slice(0, 3));
        }
      } catch (err) {
        console.error('Failed to load cached data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <ArtworkCacheContext.Provider value={{ artworks, galleries, loading }}>
      {children}
    </ArtworkCacheContext.Provider>
  );
};

export const useArtworkCache = () => {
  const context = useContext(ArtworkCacheContext);
  if (!context)
    throw new Error('useArtworkCache must be used within ArtworkCacheProvider');
  return context;
};
