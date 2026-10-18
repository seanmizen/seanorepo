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
          text: 'A parabolic flight, a panel of sliders with a copy/paste settings string, and the theme toggle in the shared layout. The panel only shows on the dev server.',
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
  ],
};

export { shader };
