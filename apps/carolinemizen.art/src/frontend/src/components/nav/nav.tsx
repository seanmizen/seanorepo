import { FC } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../constants';
import { StyledNav } from './nav.styled';

const Nav: FC = () => {
  return (
    <StyledNav>
      <Link to={ROUTES.home.path}>Home</Link>
      <Link to={ROUTES.collections.path}>Collections</Link>
      <Link to={ROUTES.swatch.path}>Swatch</Link>
    </StyledNav>
  );
};

export { Nav };
