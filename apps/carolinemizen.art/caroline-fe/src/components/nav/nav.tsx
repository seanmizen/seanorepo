import type { FC } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { ROUTES } from '../../constants';
import { useAuth } from '../../contexts/auth-context';
import { useBackendHealth } from '../../hooks/use-backend-health';
import {
  NavBrand,
  NavContainer,
  NavLinks,
  NavRight,
  StyledNav,
} from './nav.styled';

const BrandName = styled(Link)`
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-color);
  text-decoration: none;
  letter-spacing: -0.02em;
  padding: 0.25rem 0.5rem;
  border-radius: 8px;

  transition: box-shadow 120ms ease, transform 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    transform: translateY(-1px);
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }
`;

const NavLink = styled(Link)`
  color: var(--text-color-secondary);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.9375rem;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  display: inline-block;

  transition: box-shadow 120ms ease, transform 120ms ease, color 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    transform: translateY(-1px);
    color: var(--text-color);
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }
`;

const AdminButton = styled(Link)`
  padding: 0.5rem 1rem;
  background: var(--button-background-color);
  color: var(--button-text-color);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.875rem;
  border-radius: 10px;
  border: 2px solid transparent;
  display: inline-block;
  cursor: pointer;

  transition: box-shadow 120ms ease, transform 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }
`;

const LogoutButton = styled.button`
  padding: 0.5rem 1rem;
  background: transparent;
  color: #dc3545;
  border: 2px solid #dc3545;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.875rem;

  transition: box-shadow 120ms ease, transform 120ms ease, background 120ms ease,
    color 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
    background: #dc3545;
    color: white;
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }
`;

const HealthIndicator = styled.span<{ $healthy: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: ${(props) => (props.$healthy ? '#d1fae5' : '#fee2e2')};
  color: ${(props) => (props.$healthy ? '#065f46' : '#991b1b')};
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;

  &::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${(props) => (props.$healthy ? '#10b981' : '#ef4444')};
  }
`;

const Nav: FC = () => {
  const { user, logout } = useAuth();
  const isBackendHealthy = useBackendHealth();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <StyledNav>
      <NavContainer>
        <NavBrand>
          <BrandName to={ROUTES.home.path}>carolinemizen.art</BrandName>
          {!isBackendHealthy && (
            <HealthIndicator $healthy={false}>API Down</HealthIndicator>
          )}
        </NavBrand>

        <NavLinks>
          <NavLink to={ROUTES.home.path}>Home</NavLink>
          <NavLink to={ROUTES.collections.path}>Collections</NavLink>
        </NavLinks>

        {user && (
          <NavRight>
            <NavLink to="/admin">Admin</NavLink>
            <LogoutButton onClick={handleLogout}>Logout</LogoutButton>
          </NavRight>
        )}
      </NavContainer>
    </StyledNav>
  );
};

export { Nav };
