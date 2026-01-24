# Image Loading Implementation Status

**Last Updated:** 2026-01-24
**Status:** Phase 1 Complete, Phase 2 Ready to Start

---

## Overview

This project has TWO phases for image loading improvements:

### Phase 1: TanStack Query + Smooth Fade-In ✅ COMPLETE
Basic memory caching and smooth opacity transitions for images.

### Phase 2: Multi-Stage Progressive Blur Loading ⏳ READY TO START
Advanced blur-up loading with Sharp - multiple blur stages that progressively reveal the full image.

---

## Phase 1: TanStack Query + Smooth Fade-In ✅ COMPLETE

### What's Been Implemented

#### ✅ 1. TanStack Query Infrastructure
- `@tanstack/react-query` installed (v5.90.16)
- QueryProvider created at `src/providers/query-client-provider.tsx`
- Configuration:
  - `staleTime`: 5 minutes
  - `gcTime`: 30 minutes
  - No refetch on window focus or reconnect
  - Single retry on failure

#### ✅ 2. Query Hooks
All three hooks implemented in `src/hooks/queries/`:
- `useArtworks()` - fetches artworks, filters drafts
- `useGalleries(options)` - fetches all/featured galleries
- `useCarouselImages()` - fetches carousel, transforms to Artwork format
- Barrel export at `src/hooks/queries/index.ts`

#### ✅ 3. Enhanced LazyLoadImage Component
Location: `src/components/lazy-load-image/`

Features:
- Smooth opacity fade-in (0 → 1) on load
- Configurable transition timing
- Error handling with fallback image support
- Optional skeleton loading animation
- Props: `src`, `alt`, `transition`, `showSkeleton`, `fallbackSrc`

Styled components:
- `Image` - main image with opacity transition
- `PlaceholderContainer` - absolute positioned skeleton wrapper
- `Skeleton` - animated shimmer effect

#### ✅ 4. Component Refactoring

**ArtworkCacheContext** (`src/contexts/artwork-cache-context.tsx`)
- Now uses `useArtworks()` and `useGalleries()` internally
- Provides: `{ artworks, galleries, loading }`
- Acts as adapter layer for legacy components

**Home Page** (`src/pages/home/home.tsx`)
- Uses `useCarouselImages()` for carousel
- Uses `useGalleries({ featured: true })` for featured galleries
- Falls back to artworks if no carousel images

**Other Pages Updated:**
- `src/components/gallery-grid/gallery-grid.tsx` - uses LazyLoadImage
- `src/pages/artwork.tsx` - uses LazyLoadImage
- `src/pages/admin/images.tsx` - uses LazyLoadImage
- `src/pages/admin/admin-carousel.tsx` - uses LazyLoadImage
- `src/pages/admin/artwork-edit.tsx` - uses LazyLoadImage
- `src/pages/admin/gallery-edit.tsx` - uses LazyLoadImage

#### ✅ 5. Backend Cache Headers
Location: `apps/carolinemizen.art/caroline-be/src/index.ts`

Added to fastifyStatic configuration:
```typescript
setHeaders: (res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
}
```

Images cached for 1 year since filenames are unique.

---

## Phase 1: What's Left

### Testing & Verification

#### Manual Testing Checklist
- [ ] Visit `/` - carousel images fade in smoothly
- [ ] Navigate to `/collections` - gallery covers fade in
- [ ] Navigate back to `/` - carousel loads instantly (no network)
- [ ] Click on artwork - detail images fade in
- [ ] Open Network tab - verify `(memory cache)` on repeat visits
- [ ] Refresh page - check for `304 Not Modified` status codes

#### Admin Testing
- [ ] Visit `/admin/images` - library fades in
- [ ] Visit `/admin/carousel` - carousel editor fades in
- [ ] Upload new image - appears immediately
- [ ] Navigate between admin pages - images load from cache

#### Performance Testing
- [ ] Open DevTools Performance tab
- [ ] Record navigation: Home → Collections → Home
- [ ] Verify no image downloads on return to Home
- [ ] Check memory usage reasonable (<50MB for image cache)

#### Error State Testing
- [ ] Kill backend - images show error state gracefully
- [ ] Delete image file - fallback shows
- [ ] Slow 3G simulation - skeleton/fade works correctly

### Optional Cleanup
- [ ] Consider removing `ArtworkCacheContext` if not needed
- [ ] Update all components to use query hooks directly
- [ ] Remove intermediate adapter layer

---

## Phase 2: Multi-Stage Progressive Blur Loading ⏳ READY TO START

### Why This Is Better

Instead of:
1. Blank space
2. Full image pops in

We get:
1. Ultra-blurred placeholder (~150 bytes, instant)
2. Medium blur (~500 bytes, fast)
3. Light blur (~2KB, progressive)
4. Full resolution (crisp)
5. Smooth fade between each stage

Like Medium.com but with MORE stages for ultra-smooth progression.

### Technical Approach

#### Backend: Blur Data Generation

**1. Database Migration**
Add `blur_data` column to `images` table:
```sql
ALTER TABLE images ADD COLUMN blur_data TEXT DEFAULT NULL;
```

Stores JSON:
```json
{
  "ultra": "data:image/jpeg;base64,...",   // 5x5px, blur: 40
  "medium": "data:image/jpeg;base64,...",  // 20x20px, blur: 20
  "light": "data:image/jpeg;base64,..."    // 50x50px, blur: 10
}
```

**2. Sharp Blur Generation**
Create `generateBlurStages()` function using Sharp (already installed):
- Stage 1: `.resize(5, 5).blur(20).jpeg({ quality: 40 })`
- Stage 2: `.resize(20, 20).blur(10).jpeg({ quality: 50 })`
- Stage 3: `.resize(50, 50).blur(5).jpeg({ quality: 60 })`
- Convert to base64 data URIs

**3. Update Upload Handler**
Generate blur stages on image upload and store in database.

**4. Backfill Script**
Generate blur data for all existing images.

**5. Update API Responses**
Parse `blur_data` and include in all image responses:
- `/api/artworks`
- `/api/galleries`
- `/api/carousel`
- `/api/admin/images`

#### Frontend: Multi-Stage Rendering

**1. Update LazyLoadImage Component**
New props:
- `blurStages?: { ultra?: string; medium?: string; light?: string }`

Rendering strategy:
- Render ALL blur stages as absolutely positioned `<img>` elements
- Each stage has CSS `filter: blur(Npx)` and `transform: scale(1.1)` (to hide edges)
- Control visibility with opacity transitions
- Load stages progressively with separate Image() preloaders
- Show ultra immediately (base64, instant)
- Fade medium in → ultra out
- Fade light in → medium out
- Fade full in → light out

**2. Update Type Definitions**
Add `BlurStages` interface to types.ts:
```typescript
export interface BlurStages {
  ultra?: string;
  medium?: string;
  light?: string;
}
```

**3. Update All Components**
Pass `blurStages` prop to LazyLoadImage:
```tsx
<LazyLoadImage
  src={imageUrl}
  alt={alt}
  blurStages={image.blur_stages}
/>
```

**4. Remove Lazy Loading Attributes**
Change `loading="lazy"` to `loading="eager"` everywhere.
Blur stages provide better perceived performance than lazy loading.

---

## Phase 2: Implementation Checklist

### Backend Work
- [ ] Create migration: `002_add_blur_data.sql`
- [ ] Run migration
- [ ] Implement `generateBlurStages()` in `src/controllers/images.ts`
- [ ] Update upload handler to generate blur data
- [ ] Update all API responses to include `blur_stages`
- [ ] Create backfill script: `scripts/backfill-blur.ts`
- [ ] Run backfill for existing images

### Frontend Work
- [ ] Add `BlurStages` interface to `src/types.ts`
- [ ] Enhance LazyLoadImage with multi-stage support
- [ ] Update styled components for multi-stage rendering
- [ ] Update all components to pass `blurStages` prop
- [ ] Remove all `loading="lazy"` attributes
- [ ] Test progressive loading behavior

### Testing
- [ ] Verify ultra blur shows instantly
- [ ] Verify smooth transitions between stages
- [ ] Check that full image reveals correctly
- [ ] Test on slow 3G connection
- [ ] Verify no layout shift
- [ ] Check memory usage with many images

### Tuning
- [ ] Adjust blur radii if needed (40px, 20px, 10px)
- [ ] Adjust image sizes if needed (5x5, 20x20, 50x50)
- [ ] Adjust transition timing if needed (400ms)
- [ ] Consider adding more stages (optional)

---

## Performance Impact

### Phase 1 (Current)
- TanStack Query: ~14KB gzipped
- Memory cache: ~30-50MB for typical usage
- No additional network overhead

### Phase 2 (Proposed)
- Database overhead: ~2.5KB per image
- One-time generation cost on upload (~50-200ms per image)
- Network overhead: +2.5KB per image load (but base64 inline)
- Perceived performance: MUCH better (no "pop")

---

## Configuration Options

### Current Blur Stages (Aggressive)
- Ultra: 5x5px, blur 40px (~150 bytes)
- Medium: 20x20px, blur 20px (~500 bytes)
- Light: 50x50px, blur 10px (~2KB)

### Alternative: More Stages (Ultra-Smooth)
- Stage 1: 5x5, blur 50
- Stage 2: 10x10, blur 30
- Stage 3: 20x20, blur 20
- Stage 4: 40x40, blur 10
- Stage 5: Full

### Alternative: Fewer Stages (Performance)
- Stage 1: 10x10, blur 30
- Stage 2: Full

---

## Decision Point

**Before starting Phase 2, decide:**

1. **Do we want blur-up at all?**
   - Phase 1 gives smooth fade-in and memory caching
   - Phase 2 adds progressive blur reveal
   - Phase 2 is more work but significantly better UX

2. **How many blur stages?**
   - 3 stages (current plan): Good balance
   - 5 stages: Ultra-smooth but more complex
   - 2 stages: Simpler, still good

3. **Backfill strategy?**
   - Generate all at once (may take time)
   - Generate on-demand (slower first load)
   - Hybrid: Backfill popular images first

---

## Rollback Plan

### Phase 1 Rollback
```bash
cd apps/carolinemizen.art/caroline-fe
yarn remove @tanstack/react-query
git checkout HEAD -- src/
```

### Phase 2 Rollback (If Implemented)
```bash
cd apps/carolinemizen.art/caroline-be
# Rollback migration
git checkout HEAD -- src/migrations/002_add_blur_data.sql
# Revert blur generation code
git checkout HEAD -- src/controllers/images.ts
# Frontend revert
cd ../caroline-fe
git checkout HEAD -- src/components/lazy-load-image/
```

---

## Next Steps

**Immediate:**
1. Test Phase 1 implementation thoroughly
2. Run `yarn fix` to clean up formatting/linting
3. Verify memory caching is working
4. Check network tab for cache hits

**Then Decide:**
1. Are we happy with Phase 1 (smooth fade-in + memory cache)?
2. Do we want to proceed with Phase 2 (progressive blur-up)?
3. If yes to Phase 2, which blur stage configuration?

---

## Notes

- Sharp is already installed (`^0.34.5`) and ready to use
- All query keys follow TanStack Query best practices
- Images have immutable cache headers (1 year)
- No server-side rendering considerations (client-only app)
- Cache invalidation available via `queryClient.invalidateQueries()`
