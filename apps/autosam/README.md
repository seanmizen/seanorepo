# autosam

A piano practice partner for "Somewhere Only We Know" by Keane. It plays the
chords in the key that you choose, and a chord chart follows the music. Use it
to practise the song alone, at a key that fits your voice.

Live at https://autosam.seanmizen.com. Port 4090.

## What it does

- Plays the chords in the original key (A), down 2 semitones (G) or down 4
  semitones (F). A stepper moves the key by one semitone, up to 12 each way.
- Shows the chord now, the next chord, and the number of beats until it.
- Shows each chord as a number in the key. The number does not change when
  you change the key.
- Gives a count-in, a click, a tempo slider and a loop for one section.
- Lets you edit the chart in the original key. The page transposes it.

## How it works

The page is one file, `public/index.html`, with no build step and no
backend. The Web Audio API makes the piano sound in the browser. The page
loads its fonts from Google Fonts. It keeps the settings of each viewer in
`localStorage`.

The chords come from the top-rated Ultimate Guitar chart (capo 2, at concert
pitch here). They agree with the Hooktheory analysis. The number of bars in
each line is an estimate.

## Run it

```bash
yarn workspace autosam start         # http://localhost:4090
yarn workspace autosam start:docker  # the dev container, with a bind mount
yarn workspace autosam prod:docker   # the prod image, detached
yarn workspace autosam down
```

## Deploy

The tunnel sends `autosam.seanmizen.com` to `http://localhost:4090`
(`apps/cloudflared/config.yml`). The DNS record is in
`infra/cloudflare/seanmizen_com.tf`. On the LAN, the edge serves
`http://autosam.<hostname>.local` (`infra/edge/Caddyfile`).
