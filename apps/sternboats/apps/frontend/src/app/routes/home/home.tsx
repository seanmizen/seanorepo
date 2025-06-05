import { FC, useEffect, useState } from "react";
import { Arrow, Body, HeroLinksRow, HeroLinksWrapper } from "./home.styled";
import { FullScreenComponent, Nav } from "../../../components";
import { TopNav } from "../../../components/top-nav";

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
      <FullScreenComponent className="content">
        {/* Background Video Layer */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            overflow: "hidden",
            zIndex: 0,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          <iframe
            src="https://player.vimeo.com/video/1075237591?autoplay=1&muted=1&background=1&loop=1"
            frameBorder="0"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: "177.78vh",
              height: "100vh",
              transform: "translate(-50%, -50%)",
              minWidth: "100vw",
              minHeight: "56.25vw",
              border: "none",
              pointerEvents: "none",
              userSelect: "none",
            }}
            title="WICKED FELINA Charter Yacht - 2004 Bodrum Shipyard"
          />
        </div>

        {/* Overlay */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(0,0,0,0.4)",
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
        {/* TopNav */}
        <TopNav />
        {/* Centered Foreground Content */}
        <div
          style={{
            zIndex: 2,
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <h1>
            <i>Global</i> Sails
          </h1>
          <p>Boats | Service | Charter</p>
        </div>

        {/* Arrow */}
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
        <h2>Website under construction - 2025-05-30</h2>
        <h2>Hero Links</h2>
        <HeroLinksRow>
          <div>hero card</div>
          <div>hero card</div>
          <div>hero card</div>
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
