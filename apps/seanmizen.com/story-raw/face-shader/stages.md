# Story raw material: the face shader

Raw material for the first "intentionality" story. Each stage has Sean's
message as he wrote it, what Claude did, and the screenshots from that
stage. Claude took the screenshots in headless Chrome. Its software GPU runs
at about 2 frames a second, so motion shows as contact sheets, not video.

Branch: `SEAN-736/projects-page-persistent-face`. Ticket: #736.

## 01: projects becomes a link

Sean:

```text
ok time for some seanmizen.com changes. just the projects section. let's turn 'projects' into a link to /projects. we're about to get intentional about this section.
```

Claude found that the "projects" accordion was the only trigger for the
"hire me" text reveal. It asked what to do with the reveal, and gave three
options: reveal on hover, drop it from home, or keep the accordion.

Sean (the answer to that question):

```text
hire me text will be removed from home. let's see that we can make the face persistent across the site between navigations. so clicking into projects navigates to /projects, the face remains, and the 'hire me' text is revealed. I'd like it to change from an explosion outward to a fade-in, for the hire me text. that should be enough to get started. shall we?
```

Claude made "projects" a link, moved `/apps` to `/projects`, put the face in
a layout route so that it stays mounted, and replaced the radial reveal with
a fade. It checked in headless Chrome that the canvas is the same DOM node
after each navigation, and it measured the fade curve.

Screenshots: `01-projects-link/`. `1-home.png` is the new home page.
`2-` to `4-` are /projects at 0.3 s, 1.5 s and 5.5 s. `5-home-after.png` is
home after the return trip. `6-hire-lab.png` is the tuning page.

## 02: workshop, not spec

Sean (sent while Claude was opening the PR):

```text
give me a dev server. this was not an entire spec. I want to workshop it with you.
```

Claude stopped the PR and started the dev server on port 4000. No
screenshots.

## 03: the singularity

Sean:

```text
IMMEDIATE NOTES. on 'projects', can the face suddenly make all the dots shrink into a singularity? the singularity can pulse a little once it's there.
```

Claude scaled every dot toward the middle in the vertex shader, with a sine
pulse. The particle sim keeps running, so the face comes back exactly.

Screenshots: `03-singularity/`. `collapse-sheet.png` shows the face, the dot
pulsing, and the face coming back. `c-full.png` is the whole page.

## 04: no face in the dot, and an irregular pulse

Sean:

```text
I can still see the face in the singularity, which I don't like. it's also too big and throbs too much. throbbing looks kind of sinusoidal too which I don't like, it would be nice for it to be a little more irregular. make it move about its centre veeeery slightly, too, in the same manner.
```

Claude sent each dot to its own random place in a small disk, made the core
smaller, and drove the size and a small drift with two layers of value noise.

Screenshots: `04-core-noise/core-sheet.png`. It shows 12 frames at 8x zoom
over 3 seconds.

## 05: the throw, with a tuning panel

Sean:

```text
oh that's great. I like that. can you NOW make the singularity disappear to the bottom of the screen? It should appear to have a parabolic trajectory, as if we've thrown it into the distange. give me a parameterised menu for this, temporarily, and a copypaste section so I can copy in/out the configs so once I'm happy you can bake in these consts

Do this with the same margin-from-bottom that the theme mode toggle button has? on that point too I'd like the theme mode toggle to remain on this page. also use the word 'pulse' not 'throb'.
```

Claude added a parabolic flight, a dev-only panel with sliders and a
copy/paste settings string, moved the theme toggle into the shared layout,
and measured the toggle icon (27 px from the bottom) for the margin.

Screenshots: `05-throw-panel/`. `f-sheet.png` is the flight as a strip.
`f-landed.png` is the landed dot with the panel. `f-back.png` is the return.

## 06: one timeline

Sean:

```text
problem: the shrink-to-singularity happens THEN the parabolic throw. I was planning on them both happening at the same time. can you make that work? it also means navigating back and forth at any point can smoothly, nicely reverse the animation as opposed to what we have now.
```

Claude drove the collapse and the flight from one value that runs at a
steady rate. A change of direction plays the animation backward from where
it is.

Screenshots: `06-one-timeline/`. `t-forward.png` is a full throw.
`t-reverse.png` is a reversal 0.5 s into a throw.

## 07: content first, and old ripples

Sean:

```text
1. on the homepage, content should not be interfered with by the shaders. I think we had a solution to this before or potentially on the projects page now. you should implement a sleek simple solution for all content on the site. one solution, all pages work nicely. shaders are all background-only.

2. the tsunami (or whatever we called it) effect from /projects is affecting the home-page face once it has sprung back in to view. I don't want this to be the case. find the KISS-est, nicest solution which solves this.
```

Claude tried a CSS text halo first. The site's fonts are too thin for it
(Karla at weight 200), so Claude reverted it. The halo screenshots were
overwritten and are not here. The fix that stayed is a content mask: the
shader reads the line box of every text node and draws a soft mask, and the
dots and glyphs fade out there. For the ripples, the face skips every ripple
that started before it came home. Claude measured this: 0 tinted pixels on
the face after /projects ripples, against about 5,500 for the same clicks
made on home.

Screenshots: `07-content-mask/`. `home-open-*.png` is the problem, before.
`mask-*.png` is the result, after.

## 08: the code block, and Venom

Sean:

```text
1. code block under 'github' looks shit. I've saved a screenshot to my windows desktop. take a look. fix it.

2.
```

The second item was a paste of Sean's notes:

```text
oh my god, concept. can the singularity "eat" the cursor if the cursor gets too close, ie within ? like "venom" in spiderman.
when this is active, activate the css rule to hide the cursor.
This is effectively

also, the singularity resting point should be alognside the theme mode toggle. same Y centroid, X is as if we'd made another button to the left of the theme mode toggle.

current settings to bake in: (take liberties when e.g. endX should now be derived differently)
flight-v1:{"time":0.35,"collapseBy":0.25,"arc":90,"endX":410,"endSize":1,"endOpacity":1,"margin":36}
remove endOpacity too btw. since the singularity is many dots overlapping, opacity does effectively nothing.
```

Claude added whole boxes to the mask for anything that paints its own
background, such as the code block. It baked in the flight settings, added
an invisible button-sized slot for the landing point, and built tendrils
that reach for the cursor and an eat state that hides it. One bug: all
per-dot hashes came from the same index, so the tendril dots fell into
clumps. Claude fixed this with four independent random numbers for each dot.

Screenshots: `08-venom/`. `reported-code-block.png` is Sean's screenshot.
`code-block.png` is the fix. `venom-sheet.png` shows the cursor as it comes
near, is eaten, and comes back out. `tendril-clumping-bug.png` is the bug.
`tendril-cases.png` is the fix, with four settings.
