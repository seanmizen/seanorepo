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

The picker under each page selects a theme. `Auto` follows the system light
or dark setting. The choice stays on the device.

- `public/themes.css` holds one block of tokens for each theme. The page uses
  only these tokens.
- `public/theme.js` sets `data-theme` on `<html>` before the first paint, and
  fills the picker.
- A theme change morphs the page. `themes.css` registers each color token
  with `@property`, so the token moves from one color to the next over `--morph`
  (700 ms). To watch it slowly, set `--morph` higher in DevTools. Fonts
  change at once. With reduced motion, everything changes at once.

To add a theme, add a `:root[data-theme="<id>"]` block to `themes.css` and an
entry to `THEMES` in `theme.js`. `projects/intentional-design` holds the
documents that the themes come from.

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
