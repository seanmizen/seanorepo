# 02: Animations and dynamic content

TODO: flesh this out.

- The video: [Why does iOS feel so nice to use](https://www.instagram.com/p/De5oNXKteqU/), Justin Sun

## Notes

- Overscroll is not logarithmic. It is a hyperbola with a ceiling:
  `f(x) = (1 - 1 / (c·x / d + 1)) · d`, where `x` is how far the finger
  pulls, `d` is the height of the screen and `c` is a constant. The further
  you pull, the less the content follows, and it never passes one screen.
- An interrupted motion keeps its velocity. A timed animation restarts from
  zero when you grab it halfway. A spring (damped harmonic motion) carries on
  from where it is, so it feels like an object in the hand. The SwiftUI
  presets are all springs with a different amount of friction.
- autosam: a press during a morph jumps to the end of the last morph, then
  starts the next one. That is the timed-animation behaviour above.
