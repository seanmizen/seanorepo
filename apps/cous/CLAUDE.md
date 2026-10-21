# cous

- **Images of Cous are real photos or video frames.** Never generate an
  image, and never use an AI model to edit pixels. The permitted steps are
  in the README: a subject mask (`scripts/lift.swift`), flips, rotations,
  crops, resizing and the leg swing (`scripts/legs.py`).
- **Every source image goes in the gallery.** Save it with no metadata in
  `src/cous/assets/sources/` and add it to `SOURCES` in
  `src/cous/provenance.tsx`. This applies to terrain too. The README has
  the steps.
- Keep the old sprite sheets in `src/cous/assets/`. Sean keeps them for
  reference.
- Check new sprites with `?hitboxes` in the URL.
