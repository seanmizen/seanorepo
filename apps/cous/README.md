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

To add a photo of Cous, cut it out with `swift scripts/lift.swift
<photo> <out.png>` (macOS). Resize the PNG to 4 image px per logical px,
then add it to the cous theme in `src/cous/sprites.ts`. The game makes
the collision boxes from the opaque pixels. Add `?hitboxes` to the URL
to see them.

The Chromium sprite sheets in `src/cous/assets/` are under the licence in
`src/cous/LICENSE-Chromium`.
