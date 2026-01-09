# carolinemizen.art

A complete art portfolio and exhibition platform for Caroline Mizen to showcase her artwork.

## Overview

This application is a Content Management System (CMS) specifically designed for artists. Caroline can:

- Upload and manage artwork images
- Create and organize galleries/collections
- Feature galleries on the homepage
- Manage a homepage carousel for highlighting artwork
- Edit site content (hero section, about page, navigation)
- Organize artworks with drag-and-drop reordering

## Architecture

### Data Model

The platform uses a hierarchical content structure:

```
Images (flat storage)
  └─> Artworks (one or more images)
       └─> Galleries (zero or more artworks)
```

**Images**: Individual image files stored on the filesystem with metadata (dimensions, mime type, alt text)

**Artworks**: Individual pieces with title, description, and metadata. Each artwork can have multiple images for different angles/details.

**Galleries**: Curated collections of artworks with custom ordering, cover images, and SEO-friendly slugs. Up to 7 galleries can be featured on the homepage.

**Carousel**: Homepage image carousel for highlighting featured artwork or collections.

### Tech Stack

**Frontend** (`caroline-fe`):

- React 19 with React Router 7
- RSBuild (Rspack) for fast compilation
- styled-components for CSS-in-JS
- TanStack Query for data fetching
- Drag-and-drop reordering

**Backend** (`caroline-be`):

- Bun runtime
- Fastify 5 web framework
- SQLite with better-sqlite3
- JWT authentication
- Nodemailer for email notifications (magic link auth)
- RESTful API with `/api` prefix

**Infrastructure**:

- Docker with dev/prod profiles
- Named volumes for SQLite database and uploaded images
- Cloudflared deployment (ports 4020/4021)

## Setup

### Prerequisites

- Yarn 4 (via corepack)
- Docker & Docker Compose
- Email account for SMTP (Gmail recommended, for magic link authentication)

### Installation

```bash
# Enable corepack for Yarn 4
corepack enable

# Install dependencies from monorepo root
yarn install
```

### Environment Variables

Create a `.env` file in `apps/carolinemizen.art/`:

```env
# Authentication
JWT_SECRET=your-random-secret-key-here
COOKIE_SECRET=your-random-cookie-secret-here

# Database
DB_PATH=/app/db

# Email (for magic link authentication)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# File Storage
UPLOADS_PATH=/app/uploads
UPLOADS_URL=http://localhost:4021/uploads

# Frontend URL (for email links)
FRONTEND_URL=http://localhost:4020
```

**Note on Gmail**: You'll need to create an [App Password](https://support.google.com/accounts/answer/185833) if using Gmail.

## Development

### Start Development Servers

From monorepo root:

```bash
yarn caroline
```

Or run individually:

```bash
# Frontend only (port 4020)
cd apps/carolinemizen.art/caroline-fe
yarn start

# Backend only (port 4021)
cd apps/carolinemizen.art/caroline-be
yarn start
```

### Docker Development

```bash
# From app directory
cd apps/carolinemizen.art
yarn start:docker   # Runs with hot reload

# From monorepo root
yarn prod:docker    # Production build
```

## Database Schema

### Core Tables

**users** - Admin and customer accounts

- Passwordless (magic link) authentication
- Roles: admin (Caroline), guest (customers)

**magic_tokens** - One-time login links

- Expire after 15 minutes
- Single use only

**images** - Uploaded image files

- Filesystem path references
- Width/height metadata
- Alt text for accessibility

**artworks** - Individual art pieces

- Title, description, metadata
- Primary image reference
- Multiple images per artwork

**artwork_images** - Junction table

- Links artworks to images
- Custom display order

**galleries** - Collections of artworks

- URL-friendly slugs for SEO
- Cover image for preview cards
- Featured flag (max 7 on homepage)
- Custom display order with move up/down

**gallery_artworks** - Junction table

- Links galleries to artworks
- Custom display order

**site_content** - Editable page content

- Key-value storage (hero_title, about_text, etc.)
- Content types: text, html, image_id

**carousel_images** - Homepage carousel

- Links to image entries
- Custom display order for rotation

## API Endpoints

All API routes are prefixed with `/api`.

### Public Endpoints

**Galleries**

```
GET  /api/galleries              - List all galleries
GET  /api/galleries?featured=true - List featured galleries only
GET  /api/galleries/:slug        - Get gallery with artworks
```

**Artworks**

```
GET  /api/artworks            - List available artworks
GET  /api/artworks/:id        - Get artwork with images
```

**Site Content**

```
GET  /api/content             - Get all site content
GET  /api/content/:key        - Get specific content value
```

**Carousel**

```
GET  /api/carousel            - Get carousel images in display order
```

### Admin Endpoints (Authentication Required)

**Authentication**

```
POST /api/auth/magic-link     - Send magic link email
GET  /api/auth/verify         - Verify token, set JWT cookie
POST /api/auth/logout         - Clear session
GET  /api/auth/me             - Get current user
```

**Images**

```
POST   /api/admin/images/upload    - Upload image (multipart/form-data)
GET    /api/admin/images           - List images (paginated)
DELETE /api/admin/images/:id       - Delete image
```

**Artworks**

```
POST   /api/admin/artworks         - Create artwork
PUT    /api/admin/artworks/:id     - Update artwork
DELETE /api/admin/artworks/:id     - Delete artwork
```

**Galleries**

```
POST   /api/admin/galleries                - Create gallery
PUT    /api/admin/galleries/:id            - Update gallery
PUT    /api/admin/galleries/:id/artworks   - Set artworks (ordered)
POST   /api/admin/galleries/:id/move-up    - Move gallery up in order
POST   /api/admin/galleries/:id/move-down  - Move gallery down in order
PUT    /api/admin/galleries/featured       - Set featured galleries (max 7)
DELETE /api/admin/galleries/:id            - Delete gallery
GET    /api/admin/galleries/count          - Get total gallery count
```

**Carousel**

```
PUT /api/admin/carousel    - Replace all carousel images (ordered)
```

**Content**

```
PUT /api/admin/content/:key        - Update content value
```

## Frontend Routes

### Public Pages

- `/` - Homepage with hero, carousel, and featured galleries
- `/collections` - Browse all galleries
- `/collection/:slug` - View gallery with artworks
- `/artwork/:id` - Artwork detail with image carousel

### Admin Pages

- `/admin/login` - Magic link request
- `/admin/verify` - Token verification
- `/admin` - Dashboard overview
- `/admin/artworks` - Artwork management
- `/admin/artworks/new` - Create new artwork
- `/admin/artworks/:id` - Edit artwork
- `/admin/images` - Image library with pagination
- `/admin/galleries` - Gallery management
- `/admin/galleries/new` - Create new gallery
- `/admin/galleries/:id` - Edit gallery
- `/admin/carousel` - Manage homepage carousel
- `/admin/featured-galleries` - Manage featured galleries (max 7)

## Authentication Flow

carolinemizen.art uses **passwordless authentication** via magic links:

1. User enters email at `/admin/login`
2. Backend generates unique token, stores with 15min expiration
3. Email sent with link to `/admin/verify?token=xxx`
4. User clicks link, backend verifies token
5. JWT cookie set, user redirected to `/admin`

**Security features**:

- Tokens expire after 15 minutes
- Tokens can only be used once
- JWT cookies are httpOnly and secure
- Admin routes protected with auth middleware

## Storage Strategy

The platform uses **abstracted storage** to allow swapping providers:

**Current**: LocalStorageProvider

- Images stored in Docker volume at `/app/uploads`
- Served as static files via `/uploads` endpoint
- Simple, no external dependencies

**Future**: S3StorageProvider / R2StorageProvider

- Drop-in replacement via StorageProvider interface
- Cloud storage for better reliability and CDN delivery

The storage interface ensures minimal code changes when migrating.

## Testing

### E2E Testing with Playwright

```bash
# Install Playwright
yarn add -D @playwright/test

# Run tests
yarn test:e2e

# Run with UI
yarn test:e2e --ui
```

**Test coverage**:

- Magic link authentication flow
- Artwork upload and management
- Gallery creation and reordering
- Public gallery browsing
- Carousel management
- Featured galleries

## Deployment

### Production Build

```bash
# From monorepo root
yarn prod:docker
```

This starts:

- Frontend on port 4020
- Backend on port 4021
- SQLite database with named volume persistence
- Uploads stored in named volume

### SEO Features

The site includes:

- `sitemap.xml` - Auto-generated site structure for search engines
- `robots.txt` - Search engine crawling directives
- `ai.txt` - AI crawler guidelines
- Meta tags and Open Graph support for social sharing

## Design Principles

**Simple & Sleek**: Inspired by physical art galleries - clean lines, white space, minimal navigation.

**Accessibility**: All images have alt text, keyboard navigation supported, ARIA labels on interactive elements.

**Mobile-First**: Responsive design works on all screen sizes. Admin UI optimized for desktop.

**Performance**: Image lazy loading, code splitting, optimistic UI updates.

## Maintenance

### Adding New Artworks

1. Log in to `/admin/login` (magic link sent to email)
2. Navigate to "Artworks" in admin sidebar
3. Click "New Artwork"
4. Upload images (drag-drop or click)
5. Fill in title, description, metadata
6. Optionally add to galleries

### Managing the Homepage

**Carousel**: Navigate to "Carousel" in admin sidebar to:
- Select images for the homepage carousel
- Reorder carousel images with drag-and-drop
- Preview the carousel

**Featured Galleries**: Navigate to "Featured Galleries" to:
- Select up to 7 galleries to feature on homepage
- Reorder featured galleries with drag-and-drop
- Preview gallery cards with cover images

**Hero Section**: Navigate to "Site Content" to:
- Edit hero title, subtitle, call-to-action
- Update about page content

## Coding standards

### Goals

1. Full TypeScript with strict type checking, no 'as any'
2. ARIA-compliant components (keyboard navigation, screen readers, focus management)
3. Zero-dependency custom accordion/collapsible
4. Bulletproof React structure
5. Preserve git history where possible (git mv)

## FE Project Structure (Bulletproof React)

```
src/
├── app/
│   ├── routes/           # Route components
│   │   ├── home.tsx
│   │   ├── apps.tsx
│   │   └── glasto.tsx
│   ├── app.tsx           # Main app component
│   ├── provider.tsx      # Global providers wrapper
│   └── router.tsx        # Router configuration
├── assets/               # Static files (images, fonts)
├── components/           # Shared components
│   ├── accordion/
│   │   ├── accordion.tsx
│   │   ├── accordion.module.css
│   │   └── index.ts
│   ├── code/
│   ├── theme-toggle/
│   └── index.ts          # Barrel export
├── features/             # Feature modules
│   ├── github/
│   │   ├── components/
│   │   ├── github.tsx
│   │   └── index.ts
│   ├── projects/
│   ├── donate/
│   ├── xmas/
│   ├── glasto/
│   └── this-page/
├── hooks/                # Shared hooks
│   ├── use-key-sequence.ts
│   ├── use-theme.ts
│   └── index.ts
├── lib/                  # Configured libraries
│   └── router.ts
├── providers/            # Context providers
│   ├── theme.tsx
│   └── index.ts
├── types/                # Shared types
│   ├── theme.ts
│   ├── navigation.ts
│   └── index.ts
├── utils/                # Utility functions
│   ├── date.ts
│   └── index.ts
├── index.css
└── index.tsx
```
