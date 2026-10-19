# Story raw material: the face shader

Raw material for the first "intentionality" story. Each stage has Sean's
message as he wrote it, what Claude did, and the screenshots from that
stage. Claude took the screenshots in headless Chrome. Its software GPU runs
at about 2 frames a second, so motion shows as contact sheets, not video.

Branch: `SEAN-736/projects-page-persistent-face`. Tickets: #736, #737.

The live story is at `/shader-intentionality-story`. Its code is in
`src/features/intentionality/stories/shader/`.

Stages 1 to 8 were not committed while they happened. Claude rebuilt them
with the scripts in `replay/`: each script makes the edits of one stage, as
exact string swaps, from `main`. Biome runs after each stage, as `yarn fix`
did in the session. The replay through every stage gives the committed code
of stage 8 exactly, file for file. `replay/freeze.py` then copied each stage
into the story. From stage 9 on, `scripts/freeze-stage.mjs` freezes a stage
as it happens.

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

## 09: a wider mask

Sean:

```text
click in the space near the projects section's body. the 'hire me' text will show very vividly how our current system of blocking the body is, in my opinion, too tightly wrapped around our content. a wider scope for this would be nice. did we call this 'halo' or something else?
It will be helpful to extract a side-by-side comparison of before and after for this.
```

The halo was the CSS attempt in stage 7. What stayed is the content mask.
Claude widened its clear space: whole to 16 px from content and gone by
56 px, not 4 px and 16 px. Only the blur of each box goes on the mask now,
so the edge fades evenly. Claude also found that screen reader text, such as
"(opens in a new tab)", was in the mask. A parent that clips its text now
clips the box too. This was the first stage frozen as it happened, with
`scripts/freeze-stage.mjs`.

"Before" is the stage 8 sample and "after" is the live site, with the same
clicks. The captures pick the last mask canvas: in dev, StrictMode mounts the
shader twice and leaves a stale first mask.

Screenshots: `09-wider-mask/`. `projects-before-after.png` shows the lit
glyphs over 5 s of clicks beside the text, and the mask in pink.
`home-closed-before-after.png` shows that the face on home is the same.

## 10: a tight toggle, and no circle

Sean:

```text
The content mask around the theme toggle can be greatly shrunk. it is interfering with the venom. Also, the empty-face sized circle can be removed for the hire me text.
```

The wider mask of stage 9 reached the rest point beside the toggle. The mask
there was 0.78, so the core showed at about a fifth of its strength. Claude
added a tight mask for any element marked `data-mask="tight"`: no clear
space past its box, and gone 4 px past it. The theme toggle uses it, and the
mask at the core is now 0. Claude also removed the clear circle around the
face from the hire text, with its two settings. From this stage on, the
freeze script copies the theme toggle too, because the toggle now tells the
mask how much space it needs.

Screenshots: `10-tight-toggle/`. `toggle-before-after.png` shows the core
and its tendrils with the cursor near. `circle-before-after.png` shows the
whole page. "Before" is the stage 9 sample in both.

## 11: springy venom

Sean:

```text
Venom right now looks too deterministic. the tendrils are predictable (you might want to consider a noisier function to compute the flailing angle and distance) and I don't like the way in which it reaches out. not springy enough.
```

Before, one value moved all the tendrils: it eased toward its target with no
overshoot, the tendrils fanned out at fixed angles, and a sine wave writhed
them. Claude moved the tendrils into JavaScript. Each tip is a damped spring,
and its bend is a slower spring behind it, so the tendril whips. Each tendril
has its own speed and its own rough noise (four layers of value noise), which
swings the tip off the line to the cursor and stretches it. Now and then a
twitch kicks a tip. A tendril that lets go pulls back with no bounce. The
shader only draws each tendril from its tip and bend, and noise writhes it.

The reach changed too. Before, a tendril was as long as the cursor was
close, so at the edge of reach it hardly left the core. Now the tendrils
strike once the cursor is 15% inside reach, and are at most 80% of reach
long. A cursor near the edge is just out of their grasp. The panel lost
"lunge speed" and got spring, damping, flail angle, flail length, flail pace
and twitches.

A trap on the way: rsbuild finds the samples when the dev server starts. A
sample frozen after that serves the live site, so the first "before" sheet
showed the new code. The freeze script now says to restart the dev server.

Screenshots: `11-springy-venom/venom-before-after.png`. The cursor stops
108 px from the core, then 56 px, then goes away. Headless Chrome draws
about 2 frames a second, so this shows shapes, not the spring.

## 12: the jump

Sean:

```text
A new default: eat-v1:{"reach":120,"eatRadius":14,"release":86,"spring":8.3,"damping":0.28,"flail":30,"stretch":0.25,"flailPace":1.5,"twitch":0.6,"tendrils":5,"share":0.25,"spread":0.3,"strand":3,"wiggle":5.5,"gulp":1}

First, set that. Then, I want to see a real "jump" to swallow the mouse. At the moment the core of the singularity does not move. I would ideally see (as the mouse approaches) the tendrils come out to 'feel', then at a critical distance the whole mass jumps to surround the mouse. This might involve some timing, javascript, and co-ordination to disappear the cursor at the right time. the dots should "surround" the cursor so it can be visibly eaten.
```

Claude set the new defaults. Venom now has three modes:

1. Rest: the core stays home and the tendrils feel for the cursor.
2. Jump: inside the jump distance (40 px), the whole core springs onto the
   cursor's middle. On the way it opens into a rough ring (18 px), so it
   lands around the cursor. The tendrils grab the cursor as it goes.
3. Eaten: once the cursor is inside half the ring, the ring snaps shut in
   0.15 s, and the cursor is hidden when the ring is half shut. The core
   then follows the pointer, so it shows where the hidden cursor is.

Past the release distance (86 px) from where the core rests, the core lets
the cursor go and springs home. A jump that misses gives up there too. The
eat radius setting went, and jump distance, jump speed and ring size came
in.

The first jump spring (6 swings a second) covered 34 px in about 4 frames,
too fast to see as a jump. The default is now 3.

To see the eat frame by frame, Claude gave the page a frame clock it can
stop: requestAnimationFrame and performance.now() both read it, and the test
moves it 1/60 s at a time. The first try faked only the frame time stamp.
The shader's loop reads performance.now(), so its springs jumped 100 ms a
frame.

Screenshots: `12-venom-jump/`. `jump-frames.png` is the eat at 60 frames a
second, frame by frame. The arrow marks the pointer: red while it shows,
green once it is hidden. `feel-eat-follow-let-go.png` is the whole sequence
at the normal clock.

## 13: momentum, and the pull home

Sean:

```text
That's great. Two points:
The surround is too uniform, it seems disconnected to the origin of the singularity. It is cartoonish - it should look like it has momentum from jumping and therefore be a little less uniform when swallowing the mouse.
Then, after swallowing, it should be "pulling" the mouse to its origin. right now the mouse is seen to have too much control over the location of the post-swallow singularity.
```

For momentum, the shader gets the core's speed. Each dot lags behind the
moving core by its own time, mostly short and now and then long, so the
jump leaves a trail back toward where it came from. While the core moves,
the ring squashes at the front, stretches at the back and wobbles more.

That alone left the ring round at the moment of the swallow, because the
core was still by then. So the ring is also wider at the back, toward
where the core came from. It opens front first and shuts back first, so its
far side wraps round the cursor last. Claude tried two triggers for the
shut:

1. With the cursor at half the ring, the ring stayed round and open for
   about 70 ms, then shut (`try-1-round-hold.png`).
2. With the cursor anywhere inside the ring, it shut before the core
   arrived, and slammed into the cursor as a filled blob
   (`try-2-shut-too-early.png`).

The trigger that stayed is the cursor 60% of the way in, with a shut that
is fastest at first. The cursor hides while the far side still wraps it.

For the pull, once the cursor is hidden, the core no longer follows the
pointer. It drags the cursor home on a heavier spring (half the jump speed,
damping 0.9). A new "tug" setting (0.15) lets the pointer pull it that share
of the way out.

Screenshots: `13-momentum-pull/eat-and-pull-frames.png` is the jump, the
swallow and the drag home at 60 frames a second, frame by frame.

## 14: a cleanup, by the numbers

Sean:

```text
It's not so good. it prematurely jumps and stops halfway if you get close but stop.
Then, the inertial movement once captured is now completely broken.
Needs a cleanup. Take a look yourself at co-ordinate increments.
```

Claude added a temporary log of the core's state in each frame: the mode,
the pointer and the core in CSS pixels from where the core rests, and the
core's speed. A test drove the pointer one step a frame on the 60 fps test
clock. Two faults showed:

1. The pointer stopped 32 px out, and the jump began while it still came
   in. The core leapt about 23 px to the cursor's middle and began to shut
   3 px short. At the top of its overshoot the cursor hid, and in that frame
   the core turned for home. It never settled on the cursor. To Sean, it
   jumped, stopped halfway, and went back.
2. Once the core held the cursor, the pointer circled 50 px out, and the
   core moved about 7 px. The tug was a share of where the pointer was
   (0.15), on a heavy spring (damping 0.9), so the core all but ignored the
   pointer.

Venom now has four modes: rest, jump, swallow and hold.

- Jump: only once the pointer has stayed inside the jump distance for
  0.12 s, so a pointer that passes by is safe, and one that stops gets
  caught.
- Swallow: the core stays on the cursor until the ring is shut.
- Hold: a spring pulls the core home. The pointer's movement drags it, not
  where the pointer is. "Tug" now sets how strongly (default 0.5). With the
  pointer still, the core drifts home in about 0.7 s. With the pointer
  circling, the core swings round home, about 25 px out. A flick past
  release throws it after the pointer before it lets go.

The log came out before the commit.

Screenshots: `14-swallow-hold/feel-jump-swallow-hold-frames.png` is the
feel, the jump, the swallow and the start of the hold, frame by frame.

## 15: a jump that commits, and a real tail

Sean:

```text
'c:/Users/sean/Desktop/sean\'s site - Google Chrome 2026-10-19 10-11-33 - Trim - crop.mp4'
The halfway jump is still an issue. I don't know what you just did fixes much.
When moving the mouse once captured, the springiness of the singularity has been done wrong. a weird anti-inertial tail forms.
```

The video is `15-commit-and-tail/seans-video.mp4`. The machine had no ffmpeg,
so Claude decoded it in headless Chrome, frame by frame, and tiled the
frames. The home dot and the theme toggle are 52 px apart on the page and
53 px apart in the video, so a video pixel is a CSS pixel.

The halfway jump: the jump fired with the pointer 71 px from home, past the
default jump distance (40 px). So Sean's panel had a jump distance past 71,
and the core hovered, so his release distance was under 71. Claude
reproduced it with jump 80 and release 60. The mode flipped between jump
and rest every frame, and the core sat 32 px out with a speed of about
420 px/s, reversed each frame. A jump that fired was past release in the
next frame and gave up. The jump delay did not stop the next jump, because
the pointer never left. The tests in stages 12 to 14 used the defaults,
where release is past the jump distance, so they never showed it.

The tail: each dot sat at minus the core's speed times its own lag. The
speed reverses in one frame on a spring, so the whole tail flipped side in
one frame.

The fixes:

1. A jump commits. It gives up only on a pointer that leaves reach.
2. Release counts from the core, not from where the core rests, and only
   in the hold.
3. A cursor the core let go must leave the jump distance before the core
   can catch it again, so no settings can make it loop.
4. The tail is four points on springs (12 swings a second, damping 0.6),
   each behind the one before it, the first behind the core. The dots
   spread back along it, most of them near the core. It lags in a move and
   swings on past a stop.

With jump 80 and release 60, the core now jumps once, swallows, pulls the
cursor home, and lets it go 60 px from the pointer.

Screenshots: `15-commit-and-tail/`. `seans-video-*.png` are the video's
frames, and `seans-video-the-hover.png` is the hover, 3 times the size.
`jump-swallow-swing-frames.png` is the new jump, the swallow and a hold
with the pointer swung left and right, frame by frame.

## Final: stage 15

Sean:

```text
Great. That's it. Make note of that as a "final" step for this easter-egg. finish this first draft of the 'intentionality' story but also hide intentionality. I will return to it later. Commit and get ready for my next task.
```

Stage 15 is the final step of the Venom easter egg. The story marks it
"final". This is the first draft of the story. The intentionality section
is gone from the home page until Sean comes back to it. The story page
still answers at `/shader-intentionality-story`.

Still open: the Venom settings panel is temporary and shows only on the dev
server. Sean's own panel values made the final look, and they are in his
browser, not in the code. When he sends his settings string, the values
become constants, and `eat.ts` and `eat-panel.tsx` go.
