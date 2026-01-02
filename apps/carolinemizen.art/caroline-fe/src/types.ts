export interface Artwork {
  id: number;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  status: 'draft' | 'available' | 'sold';
  primary_image_id: number | null;
  primary_image_path: string | null;
  primary_image_mime_type: string | null;
  created_at: string;
  updated_at: string;
}
