import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { Entity, EntityList, HomeLi, SiteTitle, Spacer } from '@/components';
import { Donate, Github, ThisPage } from '@/features';
import { useKeySequence } from '@/hooks';

const Home: FC = () => {
  useKeySequence({
    poop: () => alert('oops, poop!'),
  });

  // The intentionality section is hidden while its first story is a draft.
  // Its story pages still answer at their own paths.
  const subsections = [
    { component: <Github />, trigger: 'github' },
    { component: <Donate />, trigger: 'donate' },
    { component: <ThisPage />, trigger: 'this page' },
  ];

  return (
    <main className="container">
      <SiteTitle />
      <p>developer | automator | person</p>
      <Spacer />
      <EntityList>
        {/* Projects has a page of its own. The other sections open here. */}
        <Entity>
          <Link to="/projects">projects</Link>
        </Entity>
        {subsections.map((subsection) => (
          <HomeLi key={subsection.trigger} trigger={subsection.trigger}>
            {subsection.component}
          </HomeLi>
        ))}
      </EntityList>
    </main>
  );
};

export { Home };
