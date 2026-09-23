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

`--charset` takes one of the site's 12 names. A wrong name is an error, and
the error lists the names. `--chars "abc..."` sets your own characters,
darkest first.

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

## Text

A spec file can put text over the frames. Each layer has an anchor
(`center`, `top-left`, `top-right`, `bottom-left` or `bottom-right`), the frame
it appears on (`from`), and optionally the frame it leaves (`to`).

```json
"text": [{ "text": "uptime: {uptime}", "anchor": "bottom-right", "from": 10 }]
```

`{hostname}` and `{uptime}` hold this machine's values. `--var name=value`
sets any variable, for example to preview another machine:
`--var hostname=asus`.

## Login

[`examples/login.json`](./examples/login.json) plays on every interactive SSH
login to a debbie machine. The managed `.zshrc` in
`utils/debbie/2026-09-17/payload/setup-developer-environment.sh` runs it with
`--play --fit`. `--fit` shrinks the width to fit the terminal, and skips a
terminal that is too small. A key press jumps to the last frame. A timeout
caps it, and errors are hidden.

Preview it on your own machine:

```bash
yarn ascii --spec utils/image-to-ascii/examples/login.json --play --fit --var hostname=asus
```

## Output

- No keyframes: one image, printed to stdout.
- `--out DIR`: frames as `DIR/0000.txt`, `DIR/0001.txt`, and so on.
- `--play`: plays the frames in this terminal, at `--fps` (default 30).
- `--pingpong`: plays forward, then back.
- `--margin N` (spec: `"margin": N`): N spaces on each side of every frame,
  and N blank lines above and below. `--fit` leaves room for it.

## Test

```bash
yarn workspace image-to-ascii test
```
