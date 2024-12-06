import { FC, useEffect, useState } from 'react';
import { Arrow, Body, HeroLinksRow, HeroLinksWrapper, LandingPage } from './home.styled';
import { Nav, PreviewCard } from '../../components';
import { ROUTES } from '../../constants';

interface HomeProps {}

const Home: FC<HomeProps> = () => {
  const [showArrow, setShowArrow] = useState(false);
  // const [shouldShowArrow, setShouldShowArrow] = useState(true);
  const [timer, setTimer] = useState<number>();
  /**
   * don't show arrow if the user has scrolled themselves
   */
  const handleScroll = () => {
    // setShouldShowArrow(false);
    console.log('rah');
    window.removeEventListener('scroll', handleScroll);
    clearTimeout();
  };

  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    setTimer(
      window.setTimeout(() => {
        console.log('showing arrow');
        setShowArrow(true);
      }, 4000),
    );
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <LandingPage>
        <h1>Art by Caroline</h1>
        <Arrow
          type="button"
          onClick={() => {
            window.scrollTo({
              top: window.innerHeight - 10,
              behavior: 'smooth',
            });
          }}
          isVisible={showArrow}
        >
          ↓ more below ↓
        </Arrow>
      </LandingPage>
      <HeroLinksWrapper>
        <h2>Hero Links</h2>
        <HeroLinksRow>
          <PreviewCard
            title="Title"
            description={`Long description of this gallery\nwith multiple lines`}
            to={ROUTES.collection.path} // TODO add id
          />
          <PreviewCard
            title="Title"
            description={`Long description of this gallery\nwith multiple lines`}
            to={ROUTES.collection.path} // TODO add id
          />
          <PreviewCard
            title="Title"
            description={`Long description of this gallery\nwith multiple lines`}
            to={ROUTES.collection.path} // TODO add id
          />
        </HeroLinksRow>
      </HeroLinksWrapper>
      <Nav />
      <Body>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
        <div>{`Sticky\nSticky\nSticky\nSticky\nSticky\nSticky\nSticky`}</div>
      </Body>
    </>
  );
};

export { Home };
export type { HomeProps };
