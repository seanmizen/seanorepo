import { FC, useEffect, useState } from "react";
import { Arrow, Body, HeroLinksRow, HeroLinksWrapper } from "./home.styled";
import { FullScreenComponent, Nav, PreviewCard } from "../../components";
import { ROUTES } from "../../constants";

interface HomeProps {}

const Home: FC<HomeProps> = () => {
  const [showArrow, setShowArrow] = useState(false);
  const [, setShouldShowArrow] = useState(true);
  const [timer, setTimer] = useState<number>();

  const handleScroll = () => {
    setShouldShowArrow(false);
    clearTimeout(timer);
    window.removeEventListener("scroll", handleScroll);
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setShouldShowArrow((prev) => {
        if (prev) setShowArrow(true);
        return prev;
      });
    }, 4000);

    setTimer(timerId);

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      clearTimeout(timerId);
    };
  }, []);

  return (
    <>
      <FullScreenComponent>
        <h1>Art by Caroline</h1>
        <Arrow
          type="button"
          onClick={() => {
            window.scrollTo({
              top: window.innerHeight - 10,
              behavior: "smooth",
            });
          }}
          isVisible={showArrow}
        >
          ↓ more below ↓
        </Arrow>
      </FullScreenComponent>
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
