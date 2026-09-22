# image-to-ascii

Turns an image into ASCII art, and turns keyframes into an ASCII animation.

The conversion is the pipeline of
[asciiart.eu/image-to-ascii](https://www.asciiart.eu/image-to-ascii), which runs
in the browser. Every slider on the site is a flag here, with the same default.
The CSS filters use the formulas of the Filter Effects spec, so the output
should be very close to the site's.

## Use

```bash
yarn ascii IMAGE --width 100 --reverse
yarn ascii IMAGE --key contrast=0:100,20:250,40:80,50:300,80:120 --play
yarn ascii --spec utils/image-to-ascii/examples/sean.json --play
```

`--reverse` flips the charset. Use it on a dark terminal. The site assumes
dark text on a light page.

`node utils/image-to-ascii/src/cli.mjs --help` lists every flag.

## Keyframes

A keyframe sets one numeric setting at one frame. Give each setting its own
keyframes, at any frames:

```bash
--key contrast=0:100,20:250,40:80 --key brightness=0:40,20:100
```

- Before a setting's first keyframe, it holds the first value.
- After its last keyframe, it holds the last value.
- Between two keyframes it moves linearly, or with `--ease smooth`.
- The animation ends at the last keyframe of any setting, unless `--frames`
  says otherwise.

A spec file holds the same things, and is easier to change and run again.
Flags override the file. Paths in the file are relative to the file. See
[`examples/sean.json`](./examples/sean.json).

## Output

- No keyframes: one image, printed to stdout.
- `--out DIR`: frames as `DIR/0000.txt`, `DIR/0001.txt`, and so on.
- `--play`: plays the frames in this terminal, at `--fps` (default 30).
- `--pingpong`: plays forward, then back.

## Test

```bash
yarn workspace image-to-ascii test
```
