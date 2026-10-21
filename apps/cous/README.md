# cous

A runner game in the style of the Chrome offline dino, at
`https://cous.seanmizen.com`. The frontend is a small React app (RSBuild)
that serves as static files. The backend (`cous-be/`) keeps the shared
high-score leaderboard.

```bash
yarn workspace cous start      # frontend only, dev server on port 4070
yarn workspace cous start:all  # frontend on 4070 and backend on 4071
yarn workspace cous-be start   # backend only, on port 4071
yarn workspace cous build      # static build in dist/
yarn workspace cous test       # backend tests
yarn workspace cous start:docker  # both, in Docker (dev profile)
```

The dev server sends `/api` requests to `http://localhost:4071`. The
frontend works with no backend. The leaderboard then shows "the
leaderboard is offline".

Production runs the `prod` Docker targets: `serve` on port 4070 and the
backend on port 4071, behind the Cloudflare tunnel. The tunnel sends
`cous.seanmizen.com/api/*` to the backend. The ports and hostnames are in
`.claude/rules/ports.md`.

## Leaderboard backend

`cous-be/` is Bun and Fastify. It keeps the scores in SQLite
(`bun:sqlite`). In Docker, the database file is
`/app/db/scores.sqlite` on the named volume `scores_data`, so a redeploy
keeps the scores. Outside Docker, the file is `cous-be/db/scores.sqlite`.
The environment variables `PORT` and `DB_PATH` change these defaults.

| Route | Result |
|---|---|
| `GET /api/health` | `{ "ok": true }` |
| `GET /api/scores` | `{ "scores": [{ "name", "score", "createdAt" }] }`, the top 10, highest first |
| `POST /api/scores` | Stores one score. Returns `201` and the new top 10 |

The body of `POST /api/scores` is
`{ "name": "cous", "score": 123, "durationMs": 45000 }`. The backend
returns `400` with an `error` message when one of these checks fails:

- `name`: 1 to 12 printable characters, after the backend trims it.
- `score`: a whole number from 0 to 99999.
- `durationMs`: the game time of the run, from 0 to 86400000 ms.
- The score must be possible in that time. The top speed is 13 px per
  frame at 60 fps, and the score is distance × 0.025. Thus a run can get
  at most 19.5 points each second (`maxScoreFor` in
  `cous-be/src/validation.ts`). If the game rules in `src/cous/game.ts`
  change, change that file too.

Each IP address can send 10 scores each minute. More requests get `429`.

After a crash, the game asks for a name when the score is in the top 10.
It keeps the last name in localStorage (`cous:name`).

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
