import type { FC, Ref, RefObject } from 'react';
import { useMatchMedia } from '@/hooks';
import type {
  EatSettings,
  HireSettings,
  ShaderRippleHandle,
} from '../shader-ripple';
import {
  EAT_DEFAULTS,
  HIRE_DEFAULTS,
  HOME_PARAMS,
  ShaderRipple,
} from '../shader-ripple';

/* Below this width the portrait draws at half size. */
const NARROW = '(max-width: 880px)';

type PortraitProps = {
  /* The hire field's settings. The /shaders-hire playground passes its
     own to tune them on the real page. */
  hire?: HireSettings;
  /* While true, the hire text fades in. When false, it fades out. */
  reveal?: boolean;
  /* While true, the face is thrown to `landing` and shrinks into a small
     pulsing core on the way. */
  thrown?: boolean;
  /* The element the core lands in the middle of. */
  landing?: RefObject<HTMLElement | null>;
  /* How the landed core reaches for the cursor and eats it. */
  eat?: EatSettings;
  ref?: Ref<ShaderRippleHandle>;
};

/* The face behind the page, fixed to the viewport. Mount it in a layout
   route, and it keeps its particles and ripples across a navigation. */
const Portrait: FC<PortraitProps> = ({
  hire = HIRE_DEFAULTS,
  reveal = false,
  thrown = false,
  landing,
  eat = EAT_DEFAULTS,
  ref,
}) => {
  const narrow = useMatchMedia(NARROW);
  return (
    <div className="shader-container" aria-hidden="true">
      <ShaderRipple
        ref={ref}
        params={HOME_PARAMS}
        size={0}
        hire={hire}
        reveal={reveal}
        thrown={thrown}
        landing={landing}
        eat={eat}
        clearOfContent
        portraitScale={narrow ? 0.5 : 1}
      />
    </div>
  );
};

export { Portrait };
