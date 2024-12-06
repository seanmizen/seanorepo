import { FC, useState } from 'react';
import { Nav } from '../../components/nav';
import { PreviewCard } from '../../components/preview-card/preview-card';

interface SwatchProps {}

const Swatch: FC<SwatchProps> = () => {
  const [urlOnLoad] = useState(window.location.toString());
  return (
    <>
      <Nav />
      <div>
        <h2>Swatch</h2>
      </div>

      <div>Preview Card:</div>
      <PreviewCard
        title="Title"
        description={`Long description of this gallery\nwith multiple lines`}
        to={urlOnLoad}
      />

      <div>
        <div>TODO:</div>
        <ol>
          <li>Color theme presentation</li>
          <li>input, select</li>
          <li>button</li>
          <li>checkbox</li>
          <li>radio</li>
          <li>switch</li>
          <li>slider</li>
          <li>progress</li>
          <li>spinner</li>
          <li>tooltip</li>
          <li>popover</li>
          <li>dialog</li>
          <li>card</li>
          <li>table</li>
        </ol>
      </div>
    </>
  );
};

export { Swatch };
export type { SwatchProps };
