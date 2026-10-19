import type { Story } from '../../types';

/* The face shader story. Sean's messages are verbatim. Each stage with a
   sample has a folder beside this file: the code of that stage, frozen. */
const shader: Story = {
  id: 'shader',
  slug: 'shader-intentionality-story',
  title: 'the face shader',
  summary:
    'a face that collapses into a singularity, is thrown, and eats your cursor',
  stages: [
    {
      title: 'where it started',
      messages: [
        {
          from: 'claude',
          text: 'The site before the session. Open "projects": the hire text bursts out from the face.',
        },
      ],
      sample: 's00-start',
    },
    {
      title: 'projects becomes a link',
      messages: [
        {
          from: 'sean',
          text: `ok time for some seanmizen.com changes. just the projects section. let's turn 'projects' into a link to /projects. we're about to get intentional about this section.`,
        },
        {
          from: 'claude',
          text: 'Opening "projects" was the only trigger for the hire text. Claude asked what to do with it.',
        },
        {
          from: 'sean',
          text: `hire me text will be removed from home. let's see that we can make the face persistent across the site between navigations. so clicking into projects navigates to /projects, the face remains, and the 'hire me' text is revealed. I'd like it to change from an explosion outward to a fade-in, for the hire me text. that should be enough to get started. shall we?`,
        },
        {
          from: 'claude',
          text: '"projects" became a link. The face moved into a layout route, so it stays mounted across navigation. The burst became a fade.',
        },
      ],
      sample: 's01-projects-link',
    },
    {
      title: 'workshop, not spec',
      messages: [
        {
          from: 'sean',
          text: 'give me a dev server. this was not an entire spec. I want to workshop it with you.',
        },
        {
          from: 'claude',
          text: 'No code changed. Claude stopped the PR and started a dev server.',
        },
      ],
    },
    {
      title: 'the singularity',
      messages: [
        {
          from: 'sean',
          text: `IMMEDIATE NOTES. on 'projects', can the face suddenly make all the dots shrink into a singularity? the singularity can pulse a little once it's there.`,
        },
        {
          from: 'claude',
          text: 'Every dot scales toward the middle in the vertex shader, with a sine pulse. The particle sim keeps running, so the face comes back exactly.',
        },
      ],
      sample: 's03-singularity',
    },
    {
      title: 'no face in the dot',
      messages: [
        {
          from: 'sean',
          text: `I can still see the face in the singularity, which I don't like. it's also too big and throbs too much. throbbing looks kind of sinusoidal too which I don't like, it would be nice for it to be a little more irregular. make it move about its centre veeeery slightly, too, in the same manner.`,
        },
        {
          from: 'claude',
          text: 'Each dot falls to its own random place in a small disk, so no trace of the face is left. Two layers of value noise drive the size and a small drift.',
        },
      ],
      sample: 's04-core-noise',
    },
    {
      title: 'the throw, and a tuning panel',
      messages: [
        {
          from: 'sean',
          text: `oh that's great. I like that. can you NOW make the singularity disappear to the bottom of the screen? It should appear to have a parabolic trajectory, as if we've thrown it into the distange. give me a parameterised menu for this, temporarily, and a copypaste section so I can copy in/out the configs so once I'm happy you can bake in these consts

Do this with the same margin-from-bottom that the theme mode toggle button has? on that point too I'd like the theme mode toggle to remain on this page. also use the word 'pulse' not 'throb'.`,
        },
        {
          from: 'claude',
          text: 'A parabolic flight, a panel of sliders with a copy/paste settings string, and the theme toggle in the shared layout. Tune the throw with the panel, top right.',
        },
      ],
      sample: 's05-throw-panel',
    },
    {
      title: 'one timeline',
      messages: [
        {
          from: 'sean',
          text: `problem: the shrink-to-singularity happens THEN the parabolic throw. I was planning on them both happening at the same time. can you make that work? it also means navigating back and forth at any point can smoothly, nicely reverse the animation as opposed to what we have now.`,
        },
        {
          from: 'claude',
          text: 'One value drives the shrink and the flight at a steady rate, so a change of direction plays the animation backward from where it is.',
        },
      ],
      sample: 's06-one-timeline',
    },
    {
      title: 'content first',
      messages: [
        {
          from: 'sean',
          text: `1. on the homepage, content should not be interfered with by the shaders. I think we had a solution to this before or potentially on the projects page now. you should implement a sleek simple solution for all content on the site. one solution, all pages work nicely. shaders are all background-only.

2. the tsunami (or whatever we called it) effect from /projects is affecting the home-page face once it has sprung back in to view. I don't want this to be the case. find the KISS-est, nicest solution which solves this.`,
        },
        {
          from: 'claude',
          text: 'A CSS text halo came first, but the fonts are too thin for it, so it was reverted. The fix is a content mask: the shader reads the line box of every text node, and the dots and glyphs fade out there. The face also skips every ripple that started before it came home.',
        },
      ],
      sample: 's07-content-mask',
    },
    {
      title: 'the code block, and Venom',
      messages: [
        {
          from: 'sean',
          text: `1. code block under 'github' looks shit. I've saved a screenshot to my windows desktop. take a look. fix it.

2.`,
        },
        {
          from: 'sean',
          text: `oh my god, concept. can the singularity "eat" the cursor if the cursor gets too close, ie within ? like "venom" in spiderman.
when this is active, activate the css rule to hide the cursor.
This is effectively

also, the singularity resting point should be alognside the theme mode toggle. same Y centroid, X is as if we'd made another button to the left of the theme mode toggle.

current settings to bake in: (take liberties when e.g. endX should now be derived differently)
flight-v1:{"time":0.35,"collapseBy":0.25,"arc":90,"endX":410,"endSize":1,"endOpacity":1,"margin":36}
remove endOpacity too btw. since the singularity is many dots overlapping, opacity does effectively nothing.`,
        },
        {
          from: 'claude',
          text: 'Anything with its own background now counts as content in the mask. The throw settings are constants, and the core lands in a slot beside the theme toggle. Tendrils reach for a cursor that comes near, and the core eats one that comes closer. A bug on the way: the tendril dots fell into clumps, because all their random numbers came from one index. Each dot now has four independent ones.',
        },
      ],
      sample: 's08-venom',
    },
    {
      title: 'a wider mask',
      messages: [
        {
          from: 'sean',
          text: `click in the space near the projects section's body. the 'hire me' text will show very vividly how our current system of blocking the body is, in my opinion, too tightly wrapped around our content. a wider scope for this would be nice. did we call this 'halo' or something else?
It will be helpful to extract a side-by-side comparison of before and after for this.`,
        },
        {
          from: 'claude',
          text: 'The halo was the CSS attempt in stage 7. What stayed is the content mask. Its clear space is now whole to 16 px from content and gone by 56 px. Before, it was 4 px and 16 px. Only the blur of each box goes on the mask, so the edge fades evenly. A bug on the way: screen reader text, such as "(opens in a new tab)", was in the mask. It is not on the screen, so a parent that clips its text now clips the box too. To compare, run stage 8 and this stage, open projects, and click beside the text.',
        },
      ],
      sample: 's09-wider-mask',
    },
    {
      title: 'a tight toggle, and no circle',
      messages: [
        {
          from: 'sean',
          text: 'The content mask around the theme toggle can be greatly shrunk. it is interfering with the venom. Also, the empty-face sized circle can be removed for the hire me text.',
        },
        {
          from: 'claude',
          text: 'The wider mask of stage 9 reached the rest point beside the toggle, so the core showed at about a fifth of its strength. An element can now ask for a tight mask, and the toggle does: none of its clear space reaches the core now. The hire text no longer keeps a circle clear for a face that is not there.',
        },
      ],
      sample: 's10-tight-toggle',
    },
    {
      title: 'springy venom',
      messages: [
        {
          from: 'sean',
          text: `Venom right now looks too deterministic. the tendrils are predictable (you might want to consider a noisier function to compute the flailing angle and distance) and I don't like the way in which it reaches out. not springy enough.`,
        },
        {
          from: 'claude',
          text: 'Each tendril tip is now a damped spring, and its bend is a slower spring behind it, so the tendril whips. Rough noise of its own swings each tip off the line to the cursor and stretches it, and now and then a twitch kicks it. Noise writhes it, not a sine wave. The reach changed too: the tendrils strike as soon as the cursor comes into reach, but they cannot reach all the way out. The panel has new sliders for the spring and the flailing.',
        },
      ],
      sample: 's11-springy-venom',
    },
    {
      title: 'the jump',
      messages: [
        {
          from: 'sean',
          text: `A new default: eat-v1:{"reach":120,"eatRadius":14,"release":86,"spring":8.3,"damping":0.28,"flail":30,"stretch":0.25,"flailPace":1.5,"twitch":0.6,"tendrils":5,"share":0.25,"spread":0.3,"strand":3,"wiggle":5.5,"gulp":1}

First, set that. Then, I want to see a real "jump" to swallow the mouse. At the moment the core of the singularity does not move. I would ideally see (as the mouse approaches) the tendrils come out to 'feel', then at a critical distance the whole mass jumps to surround the mouse. This might involve some timing, javascript, and co-ordination to disappear the cursor at the right time. the dots should "surround" the cursor so it can be visibly eaten.`,
        },
        {
          from: 'claude',
          text: 'The tendrils still feel for the cursor. Inside the jump distance, the whole core springs onto the cursor and opens into a rough ring on the way, so it lands around the cursor. Then the ring snaps shut, and the cursor is hidden once the ring is half shut. The core then holds the cursor and follows the pointer, until the pointer goes past the release distance from where the core rests. The first jump spring covered the distance in about 4 frames, too fast to see as a jump, so the default is slower.',
        },
      ],
      sample: 's12-venom-jump',
    },
    {
      title: 'momentum, and the pull home',
      messages: [
        {
          from: 'sean',
          text: `That's great. Two points:
The surround is too uniform, it seems disconnected to the origin of the singularity. It is cartoonish - it should look like it has momentum from jumping and therefore be a little less uniform when swallowing the mouse.
Then, after swallowing, it should be "pulling" the mouse to its origin. right now the mouse is seen to have too much control over the location of the post-swallow singularity.`,
        },
        {
          from: 'claude',
          text: 'Each dot now lags behind the moving core by its own time, so the jump leaves a trail back toward where it came from. While the core moves, the ring squashes at the front and stretches at the back. The ring is also wider at the back, it opens front first and it shuts back first, so its far side wraps round the cursor last. It starts to shut while the core still moves. Once the cursor is gone, the core drags it home on a heavier spring, and the pointer only tugs at it.',
        },
      ],
      sample: 's13-momentum-pull',
    },
    {
      title: 'a cleanup, by the numbers',
      messages: [
        {
          from: 'sean',
          text: `It's not so good. it prematurely jumps and stops halfway if you get close but stop.
Then, the inertial movement once captured is now completely broken.
Needs a cleanup. Take a look yourself at co-ordinate increments.`,
        },
        {
          from: 'claude',
          text: "Claude logged the core's place and speed every frame. Two faults showed. The core began to pull home the moment the cursor was hidden, at the top of its leap, so it turned back before it settled on the cursor. And once it held the cursor, it moved about 7 px while the pointer circled 50 px out. Now Venom has four modes. It jumps only once the pointer has stayed close for 0.12 s. It stays on the cursor until the ring is shut. Then a spring pulls it home, and the pointer's movement drags it, not where the pointer is.",
        },
      ],
      sample: 's14-swallow-hold',
    },
  ],
};

export { shader };
