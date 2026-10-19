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

The Chromium sprite sheets in `src/cous/assets/` are under the licence in
`src/cous/LICENSE-Chromium`.
