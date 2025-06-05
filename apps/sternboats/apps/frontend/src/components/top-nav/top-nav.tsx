import { FC } from "react";
import { Link } from "react-router-dom";
import { StyledNav } from "./top-nav.styled";
import { ROUTES } from "../../app/constants";

const TopNav: FC = ({ ...props }) => (
  <StyledNav {...props}>
    <div className="container">
      <div className="left">
        <span style={{ fontWeight: "bold" }}>GLOBAL SAILS</span>
        <Link to={ROUTES.home.path}>Home</Link>
        <Link to={ROUTES.swatch.path}>Swatch</Link>
      </div>
      <div className="right">
        <Link to={ROUTES.swatch.path}>Another link, perhaps a button</Link>
      </div>
    </div>
  </StyledNav>
);

export { TopNav };
