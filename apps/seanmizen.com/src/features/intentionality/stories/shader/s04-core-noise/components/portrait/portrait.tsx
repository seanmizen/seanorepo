import type { FC } from 'react';
import { useMatchMedia } from '@/hooks';
import type { HireSettings } from '../shader-ripple';
import { HIRE_DEFAULTS, HOME_PARAMS, ShaderRipple } from '../shader-ripple';

/* The page content the hire text keeps clear of. */
const CONTENT = 'main.container > :is(h1, h2, p, ul, nav)';

/* Below this width the portrait draws at half size. */
const NARROW = '(max-width: 880px)';

type PortraitProps = {
  /* The hire field's settings. The /shaders-hire playground passes its
     own to tune them on the real page. */
  hire?: HireSettings;
  /* While true, the hire text fades in. When false, it fades out. */
  reveal?: boolean;
  /* While true, the face falls into a small pulsing core. */
  collapse?: boolean;
};

/* The face behind the page, fixed to the viewport. Mount it in a layout
   route, and it keeps its particles and ripples across a navigation. */
const Portrait: FC<PortraitProps> = ({
  hire = HIRE_DEFAULTS,
  reveal = false,
  collapse = false,
}) => {
  const narrow = useMatchMedia(NARROW);
  return (
    <div className="shader-container" aria-hidden="true">
      <ShaderRipple
        params={HOME_PARAMS}
        size={0}
        hire={hire}
        reveal={reveal}
        collapse={collapse}
        clearSelector={CONTENT}
        portraitScale={narrow ? 0.5 : 1}
      />
    </div>
  );
};

export { Portrait };
