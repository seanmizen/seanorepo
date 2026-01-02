# carolinemizen.art

A complete art exhibition and e-commerce platform for Caroline Mizen to showcase and sell her artwork.

## Overview

This application combines a Content Management System (CMS) and e-commerce functionality specifically designed for artists. Caroline can:

- Upload and manage artwork images
- Create and organize galleries/collections
- Sell physical artwork with Stripe payment processing
- Edit site content (hero section, about page, navigation)
- Manage orders and shipping

## Architecture

### Data Model

The platform uses a hierarchical content structure:

```
Images (flat storage)
  └─> Artworks (one or more images)
       └─> Galleries (zero or more artworks)
```

**Images**: Individual image files stored on the filesystem with metadata (dimensions, mime type, alt text)

**Artworks**: Sellable pieces with title, description, price, and status (draft/available/sold). Each artwork can have multiple images for different angles/details.

**Galleries**: Curated collections of artworks with custom ordering. Featured galleries appear on the homepage.

### Tech Stack

**Frontend** (`caroline-fe`):

- React 19 with React Router 7
- RSBuild (Rspack) for fast compilation
- styled-components for CSS-in-JS
- TanStack Query for data fetching
- Stripe embedded checkout

**Backend** (`caroline-be`):

- Bun runtime
- Fastify 5 web framework
- SQLite with better-sqlite3
- JWT authentication
- Nodemailer for email notifications
- Stripe API for payments

**Infrastructure**:

- Docker with dev/prod profiles
- Named volumes for SQLite database and uploaded images
- Cloudflared deployment (ports 4020/4021)

## Setup

### Prerequisites

- Yarn 4 (via corepack)
- Docker & Docker Compose
- Stripe account (for payments)
- Email account for SMTP (Gmail recommended)

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

# Stripe (get from https://dashboard.stripe.com/test/apikeys)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

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

**artworks** - Individual pieces for sale

- Title, description, price (in pence/cents)
- Status: draft, available, sold
- Multiple images per artwork

**artwork_images** - Junction table

- Links artworks to images
- Custom display order

**galleries** - Collections of artworks

- URL-friendly slug
- Featured flag for homepage
- Custom display order

**gallery_artworks** - Junction table

- Links galleries to artworks
- Custom display order

**site_content** - Editable page content

- Key-value storage (hero_title, about_text, etc.)
- Content types: text, html, image_id

**orders** - Purchase records

- Stripe session/payment intent IDs
- Customer email and shipping address
- Order status workflow: pending → paid → shipped → delivered

## API Endpoints

### Public Endpoints

**Galleries**

```
GET  /galleries           - List all galleries
GET  /galleries/:slug     - Get gallery with artworks
```

**Artworks**

```
GET  /artworks            - List available artworks
GET  /artworks/:id        - Get artwork with images
```

**Site Content**

```
GET  /content             - Get all site content
GET  /content/:key        - Get specific content value
```

**Checkout**

```
POST /checkout/create-session  - Create Stripe checkout
GET  /checkout/session-status  - Check payment status
POST /checkout/webhook         - Stripe webhook handler
```

### Admin Endpoints (Authentication Required)

**Authentication**

```
POST /auth/magic-link     - Send magic link email
GET  /auth/verify         - Verify token, set JWT cookie
POST /auth/logout         - Clear session
GET  /auth/me             - Get current user
```

**Images**

```
POST   /admin/images/upload    - Upload image (multipart/form-data)
GET    /admin/images           - List images (paginated)
DELETE /admin/images/:id       - Delete image
```

**Artworks**

```
POST   /admin/artworks         - Create artwork
PUT    /admin/artworks/:id     - Update artwork
DELETE /admin/artworks/:id     - Delete artwork
```

**Galleries**

```
POST   /admin/galleries                - Create gallery
PUT    /admin/galleries/:id            - Update gallery
PUT    /admin/galleries/:id/artworks   - Set artworks (ordered)
DELETE /admin/galleries/:id            - Delete gallery
```

**Orders**

```
GET /admin/orders              - List orders (paginated)
GET /admin/orders/:id          - Get order details
PUT /admin/orders/:id/status   - Update order status
```

**Content**

```
PUT /admin/content/:key        - Update content value
```

## Frontend Routes

### Public Pages

- `/` - Homepage with hero and featured galleries
- `/galleries` - Browse all galleries
- `/galleries/:slug` - View gallery with artworks
- `/artwork/:id` - Artwork detail with image carousel
- `/checkout/:artworkId` - Stripe embedded checkout
- `/checkout/return` - Order confirmation

### Admin Pages

- `/admin/login` - Magic link request
- `/admin/verify` - Token verification
- `/admin` - Dashboard overview
- `/admin/artworks` - Artwork management
- `/admin/artworks/:id` - Create/edit artwork
- `/admin/galleries` - Gallery management
- `/admin/galleries/:id` - Create/edit gallery
- `/admin/orders` - Order list
- `/admin/orders/:id` - Order details
- `/admin/content` - Edit site content

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

## Payment Processing

Uses **Stripe Embedded Checkout** for secure payment processing:

1. Customer clicks "Purchase" on artwork detail page
2. Frontend creates checkout session via `/checkout/create-session`
3. Stripe embedded checkout loads with:
   - Artwork details and price
   - Shipping address collection
   - Secure card payment
4. On successful payment, Stripe webhook fires
5. Backend creates order record, marks artwork as sold
6. Customer receives confirmation email

**Stripe Webhook Events**:

- `checkout.session.completed` - Create order
- `payment_intent.succeeded` - Mark order as paid

**Test Mode**: Use Stripe test card `4242 4242 4242 4242` for development.

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
- Stripe checkout flow (test mode)
- Order status updates

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

### Stripe Webhook Setup

In production, configure Stripe webhook endpoint:

```
https://yourdomain.com/checkout/webhook
```

Events to listen for:

- `checkout.session.completed`
- `payment_intent.succeeded`

Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET` env variable.

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
5. Fill in title, description, price
6. Set status to "Available"
7. Optionally add to galleries

### Managing Orders

1. Navigate to "Orders" in admin sidebar
2. View pending orders
3. Update status as artwork is shipped
4. Customer receives email notifications

### Editing Homepage

1. Navigate to "Site Content" in admin sidebar
2. Edit hero title, subtitle, call-to-action
3. Set featured galleries (shown on homepage)

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
