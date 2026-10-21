# cous

A runner game in the style of the Chrome offline dino, at
`https://cous.seanmizen.com`. It is a small React app (RSBuild) that serves
as static files.

```bash
yarn workspace cous start      # dev server on port 4070
yarn workspace cous build      # static build in dist/
```

Production runs the `prod` Docker target (`serve` on port 4070) behind the
Cloudflare tunnel. The ports and hostnames are in `.claude/rules/ports.md`.

## Provenance

Every image of Cous in the game is a real photo or video frame. The
permitted processing is:

- a subject mask (`scripts/lift.swift`, the macOS Vision framework)
- a colour key on blue sky (`scripts/skykey.py`), when Vision finds no
  subject
- flips, rotations, crops and resizing
- the leg swing (`scripts/legs.py`), which moves the photo's own pixels

Do not use generated or AI-edited images.

The page shows every source image beside the sprite made from it, in the
"where the sprites come from" accordion (`src/cous/provenance.tsx`).

## Add a source image

This applies to player sprites, and to terrain (obstacles, clouds and
ground) when the game gets more of it.

1. Cut the subject out: `swift scripts/lift.swift <photo> <out.png>`
   (macOS).
2. Resize the cutout to 4 image px per logical px. Save it in
   `src/cous/assets/cous/`.
3. Add the cutout to the cous theme in `src/cous/sprites.ts`. The game
   makes the collision boxes from the opaque pixels. Add `?hitboxes` to
   the URL to see them.
4. Save a copy of the source with no metadata in
   `src/cous/assets/sources/`. For example:
   `magick <photo> -auto-orient -resize 1200x1200 -strip -quality 80 <name>.jpg`.
5. Add an entry to `SOURCES` in `src/cous/provenance.tsx`. Give the
   sprite name, the source, the cutout and the steps, in order.

The Chromium sprite sheets in `src/cous/assets/` are under the licence in
`src/cous/LICENSE-Chromium`.
