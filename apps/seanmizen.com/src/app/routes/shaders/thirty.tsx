import type { FC } from 'react';
import { useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SiteTitle, ThemeToggle, ThirtyBg } from '@/components';
import { ThemeContext } from '@/providers';

/* A preview of the thirty background. ?city=n shows city n of
   public/thirty/index.json. Without it, a random city. */
const ThirtyPreview: FC = () => {
  const { mode, toggleMode } = useContext(ThemeContext);
  const city = useSearchParams()[0].get('city');
  return (
    <main className="container">
      <SiteTitle path="projects/shaders/thirty" />
      <ThirtyBg city={city === null ? undefined : Number(city)} />
      <div className="bottom-right-controls">
        <ThemeToggle mode={mode} toggleMode={toggleMode} />
      </div>
    </main>
  );
};

export { ThirtyPreview };
