# autosam

A piano practice partner. It plays the chords of a song in the key that you
choose, and a chord chart follows the music. Use it to practise a song alone,
at a key that fits your voice.

Live at https://autosam.seanmizen.com. Port 4090.

## Pages

- `/` is the library. It lists the songs and the archived songs, and it has
  a form to add a song.
- `/<slug>` plays one song, for example `/somewhere-only-we-know`.

## The song file

Each song is one text file. The settings come first, one `name: value` on
each line. The chord chart follows, in the key of the record.

```text
title: Somewhere Only We Know
artist: Keane
key: A
tempo: 86
suggest: -2, -4

[Intro]
A | A/G# Asus4/G# A/G# | Bm7 | Esus4 E Esus4
```

| Setting   | Use |
| --------- | --- |
| `title`   | Required. At most 120 characters. |
| `artist`  | Optional. |
| `slug`    | Optional. The address of the song. Without it, the slug comes from the title: "Café & Bar!" gives `cafe-and-bar`. |
| `key`     | Required. A note and an optional `m`: `A`, `Bb`, `F#m`. |
| `tempo`   | Optional. 30 to 240 beats a minute. The default is 90. |
| `suggest` | Optional. At most two transpositions in semitones, for example `-2, -4`. They become key buttons. |
| `notes`   | Optional. One line of text under the chart. |

`[Name]` starts a section. `|` divides bars. Each bar is 4/4. Two chords in
a bar land on beats 1 and 3. Three land on 1, 2&, 4. Four get one beat each.
`Chord@beat` puts a chord on a given beat. `public/song-format.js` is the
parser. The page and the server both use it.

## Keys

The key buttons are the original key and the suggestions of the song. The
stepper moves the key by one semitone or by one octave, up to 24 semitones
each way. The key shows as `A♭(4) (−1 semitone)`: the tonic of the original
key is in octave 4.

## Themes

A pane at the bottom left of each page has two buttons: theme (`Baseline`,
`KBBQ`) and mode (`Auto`, `Light`, `Dark`). Each press selects the next
value. `Auto` follows the system light or dark setting. The choice stays on
the device.

A URL can give both: `/?theme=kbbq&mode=dark` opens the page in KBBQ dark,
and the device keeps that choice. A press writes the choice back to the URL.
The defaults (`baseline`, `auto`) stay out of the URL.

- `public/themes.css` holds the tokens of each theme, in a light and a dark
  block. The page uses only these tokens: colors, `--shadow`, the radii
  `--radius-card` and `--radius-control`, `--display-weight` and the fonts.
  It registers each token that can interpolate with `@property`, so the
  token moves to its new value over `--morph` (700 ms).
- `public/modern-normalize.css` (MIT, v3.0.1) gives every browser the same
  base styles. It is a copy, because the page CSP allows only this site.
  Biome skips it, so it stays the same as the upstream file.
- `public/theme.js` sets `data-theme` and `data-mode` on `<html>` before the
  first paint, and wires the pane.
- `public/morph.js` morphs the text. On each change it draws every visible
  character on a WebGL layer, and changes each glyph from its old font,
  place, size and color to the new ones. Each glyph is a signed distance
  field (SDF): an image where each pixel holds its distance to the glyph
  edge. A blend of two fields gives a shape between the two glyphs. A little
  blur halfway smooths the creases of the blend, and only where the two
  glyphs differ. Boxes morph too: each box with text in it moves from its
  old size to its new size. One clock moves the glyphs, the boxes and the
  tokens.
- The first and last frames match the page pixel for pixel. morph.js draws
  each glyph as the page draws it: in its own color and at its subpixel
  place. It uses a GPU canvas in the document, so the canvas gets the font
  smoothing of the page. The baseline comes from layout. Only content that the page
  paints morphs: the text of a closed accordion stays hidden.

The morph assumes a static page. A scroll or a resize ends it. To watch it
slowly, set `--morph` higher in DevTools. With reduced motion, or with no
WebGL2, everything changes at once.

To add a theme, add a light and a dark block to `themes.css` and an entry to
`THEMES` in `theme.js`. `projects/intentional-design` holds the documents
that the themes come from. KBBQ is the enemy: the generic look of a modern
web app, copied on purpose.

## The API

| Route | Use |
| ----- | --- |
| `GET /api/health` | `{ok, songs, editing}` |
| `GET /api/songs` | The songs and the archived songs |
| `GET /api/songs/<slug>` | `{slug, title, text, version}` |
| `POST /api/songs` | Add a song. Body `{text}`. |
| `PUT /api/songs/<slug>` | Change a song. Body `{text, version}`. A new slug moves the song. |
| `DELETE /api/songs/<slug>` | Archive a song. The server deletes nothing. |
| `POST /api/archive/<id>/restore` | Restore an archived song |
| `POST /api/auth/check` | 204 when the edit key is right |

The routes that write need `Authorization: Bearer <AUTOSAM_EDIT_KEY>`.

- Without a key of 12 characters or more on the server, they answer 503.
  The songs are then read-only.
- After 10 wrong keys in 10 minutes, a client gets 429 until the window ends.
- A change with an old `version` gets 409, so one edit cannot overwrite
  another.
- The server refuses a song that the parser refuses (422), and a request
  body over 64 KB (413).

## Data

The songs live in `AUTOSAM_DATA_DIR`. In production, that is the named
volume `autosam_songs_data` on asus.

- `songs/<slug>.txt` holds the songs in the library.
- `archive/<slug>--<time>.txt` holds the archived songs.
- `history/<slug>/<time>.txt` holds the old text of each changed song.

The repo ships its songs in `songs/`. The server copies each one into the
data folder once. A song that someone archives does not come back at the
next start.

## Run it

```bash
yarn workspace autosam start         # http://localhost:4090, edit key "local-dev-edit-key"
yarn workspace autosam test          # bun test
yarn workspace autosam test:types    # tsc --noEmit
yarn workspace autosam start:docker  # the dev container
yarn workspace autosam prod:docker   # the prod image, detached
yarn workspace autosam down
```

## Deploy

The tunnel sends `autosam.seanmizen.com` to `http://localhost:4090`
(`apps/cloudflared/config.yml`). The DNS record is in
`infra/cloudflare/seanmizen_com.tf`. On the LAN, the edge serves
`http://autosam.<hostname>.local` (`infra/edge/Caddyfile`).

To turn on editing in production, put the key in `apps/autosam/.env` on
asus, then start the container again:

```bash
AUTOSAM_EDIT_KEY=<a long random key>
```
