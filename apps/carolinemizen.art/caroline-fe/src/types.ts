/**
 * The media fields of an image row. The backend fills width, height,
 * thumbhash, variants and poster_path after the upload. Until then they are
 * null. variants is a JSON array of { width, path }.
 */
export interface ImageMedia {
  storage_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  thumbhash: string | null;
  variants: string | null;
  poster_path: string | null;
}

/**
 * The media fields of an image that a query joins to another row, with a
 * prefix. Example: JoinedMedia<'cover_image'> has cover_image_thumbhash.
 */
export type JoinedMedia<P extends string> = {
  [K in
    | `${P}_path`
    | `${P}_mime_type`
    | `${P}_thumbhash`
    | `${P}_variants`
    | `${P}_poster_path`]: string | null;
} & {
  [K in `${P}_width` | `${P}_height`]: number | null;
};

export interface Artwork extends JoinedMedia<'primary_image'> {
  id: number;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  status: 'draft' | 'available' | 'sold';
  primary_image_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Gallery extends JoinedMedia<'cover_image'> {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_image_id: number | null;
  is_featured: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}
