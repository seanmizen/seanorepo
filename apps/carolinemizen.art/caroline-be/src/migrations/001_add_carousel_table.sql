-- Migration 001: Add carousel_images table
-- This table stores the images displayed in the homepage carousel

CREATE TABLE IF NOT EXISTS carousel_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_carousel_display_order ON carousel_images(display_order);
