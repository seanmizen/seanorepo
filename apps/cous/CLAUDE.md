# cous

- **Images of Cous are real photos or video frames.** Never generate an
  image, and never use an AI model to edit pixels. The permitted steps are
  in the README: a subject mask (`scripts/lift.swift`), a sky key
  (`scripts/skykey.py`), flips, rotations, crops, resizing, the leg
  swing (`scripts/legs.py`) and a perch (`scripts/perch.py`).
- **A photo from someone else needs its licence and credit.** The bird
  photos are from Wikimedia Commons. Add each one to the README table and
  to `BIRD_CREDITS` in `src/cous/provenance.tsx`.
- **Every source image goes in the gallery.** Save it with no metadata in
  `src/cous/assets/sources/` and add it to `SOURCES` in
  `src/cous/provenance.tsx`. This applies to terrain too. The README has
  the steps.
- Keep the old sprite sheets in `src/cous/assets/`. Sean keeps them for
  reference.
- Check new sprites with `?hitboxes` in the URL.
