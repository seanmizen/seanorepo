import type { FC } from 'react';
import styles from './xmas.module.css';

interface Present {
  title: string;
  href?: string;
  linklabel?: string;
  description?: string;
  arialabel?: string;
}

type PresentLists = Record<string, Present[]>;

const presentLists: PresentLists = {
  Mum: [
    {
      title: 'TODO',
    },
  ],
  'Mark, Chelsea, and Baby Dom': [
    {
      title: 'TODO',
    },
  ],
  Sean: [
    {
      title: 'Kitchen Tap',
      href: 'https://amzn.eu/d/f3ux540',
      linklabel: 'see here',
      description:
        'MUST HAVE:\n -separate hot/cold handle (not a mixer)\n -pull-out spray\n\n',
    },
    {
      title: 'Impulse Labs induction hob',
      href: 'https://www.impulselabs.com/product',
      linklabel: 'see here',
    },
  ],
};

const Xmas: FC = () => {
  return (
    <>
      <div
        className={styles['emoji-header']}
        role="img"
        aria-label="Christmas decorations"
      >
        🎅🎄👶🕯️🫏🐑🏚️
      </div>
      {Object.keys(presentLists).map((key) => (
        <div key={key}>
          <div>{key}:</div>
          <ul className={`${styles['ul-link']} ${styles['ul-padded-left']}`}>
            {presentLists[key].map((present) => (
              <li key={present.title} style={{ whiteSpace: 'pre-wrap' }}>
                {present.title}
                {present.href && (
                  <>
                    {' '}
                    -{' '}
                    <a
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={
                        present.arialabel || `Link to ${present.title}`
                      }
                      href={present.href}
                    >
                      {present.linklabel}
                    </a>
                    {present.description && (
                      <>
                        <br />
                        <br />
                        {present.description}
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <br />
        </div>
      ))}
    </>
  );
};

export { Xmas };
