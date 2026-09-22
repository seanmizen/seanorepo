---
paths:
  - "apps/carolinemizen.art/**"
---

# carolinemizen.art

An art portfolio CMS. **It is not a shop.** The code has no Stripe, payment or
order logic. The `orders` table still exists in old databases, but nothing
uses it. Do not add commerce back.

- Frontend: React + RSBuild, port 4020. Backend: Bun + Fastify, port 4021,
  with every route under `/api`.
- SQLite at `$DB_PATH/database.db`, with migrations in
  `caroline-be/src/migrations`. Uploads live under `$UPLOADS_PATH`, served at
  `/api/uploads/`. In production both are Docker volumes
  (`carolinemizenart_sqlite_data`, `carolinemizenart_uploads_data`) on asus.
- File storage goes through a provider interface (local today, S3/R2 later).
- Admin sign-in is a passwordless magic link.
- Features: the homepage carousel, up to 7 featured galleries (drag-and-drop
  order), galleries with SEO slugs and cover images, a paginated image library,
  and editable hero and site content.
- SEO: `sitemap.xml`, `robots.txt`, `ai.txt`, and meta tags.
