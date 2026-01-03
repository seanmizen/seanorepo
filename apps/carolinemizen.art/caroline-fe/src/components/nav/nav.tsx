import type { FC } from 'react';
import { Link } from 'react-router-dom';
import styled, { css } from 'styled-components';
import { ROUTES } from '@/constants';
import { useAuth } from '@/contexts/auth-context';
import { useBackendHealth } from '@/hooks/use-backend-health';

type NavDock = 'top' | 'bottom';

const groupHalo = css`
  position: relative;
  isolation: isolate;

  &::before {
    content: "";
    position: absolute;
    inset: -18px -28px;
    z-index: -1;
    pointer-events: none;

    background: radial-gradient(
      ellipse 140% 130% at 50% 50%,
      rgba(255, 255, 255, 0.5) 0%,
      rgba(255, 255, 255, 0.9) 45%,
      transparent 75%
    );

    filter: blur(22px);
  }
`;

export const StyledNav = styled.nav<{ $dock?: NavDock }>`
  position: sticky;
  top: ${(p) => (p.$dock === 'bottom' ? 'auto' : '0')};
  bottom: ${(p) => (p.$dock === 'bottom' ? '0' : 'auto')};
  z-index: 1000;

  /* background: var(--nav-background-color); */
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  border-top: 1px solid var(--border-color-secondary);
  border-bottom: 1px solid var(--border-color-secondary);
`;

export const NavContainer = styled.div`
  max-width: 1040px;
  margin: 0 auto;
  padding: 0.75rem clamp(12px, 4vw, 22px);
  box-sizing: border-box;

  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
`;

const Spacer = styled.div`
  flex: 1 1 auto;

  @media (max-width: 720px) {
    display: none;
  }
`;

const NavBrand = styled.div`
  ${groupHalo}
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 0 1 auto;

  @media (max-width: 720px) {
    width: 100%;
    justify-content: space-between;
    display: none;
  }
`;

const NavLinks = styled.div`
  ${groupHalo}
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 0 1 auto;

  @media (max-width: 720px) {
    width: 100%;
    justify-content: space-between;
  }
`;

const NavRight = styled.div`
  ${groupHalo}
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 0 1 auto;

  @media (max-width: 720px) {
    width: 100%;
    justify-content: space-between;
  }
`;

const BrandText = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const BrandName = styled(Link)`
  font-size: 1.2rem;
  font-weight: 650;
  color: var(--text-color);
  text-decoration: none;
  letter-spacing: -0.02em;

  padding: 0.35rem 0.55rem;
  border-radius: 10px;

  display: inline-flex;
  align-items: center;
  min-width: 0;

  transition: background 120ms ease, color 120ms ease;

  &:hover {
    background: var(--hover-tint);
    color: var(--text-color);
  }

  @media (max-width: 720px) {
    font-size: 1.1rem;
  }

  @media (hover: none) {
    &:hover {
      background: transparent;
    }
  }
`;

const NavItemLink = styled(Link)`
  color: var(--text-color-secondary);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.95rem;

  padding: 0.65rem 0.85rem;
  border-radius: 12px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  box-sizing: border-box;

  transition: background 120ms ease, color 120ms ease;

  &:hover {
    background: var(--hover-tint);
    color: var(--text-color);
  }

  &:active {
    background: color-mix(in srgb, var(--hover-tint) 70%, transparent);
  }

  @media (max-width: 720px) {
    flex: 1 1 0;
  }

  @media (hover: none) {
    &:hover {
      background: transparent;
      color: var(--text-color-secondary);
    }
  }
`;

const LogoutButton = styled.button`
  padding: 0.65rem 0.85rem;
  background: transparent;
  color: #dc3545;
  border: 2px solid #dc3545;
  border-radius: 12px;

  cursor: pointer;
  font-weight: 700;
  font-size: 0.9rem;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  box-sizing: border-box;

  transition: background 120ms ease, color 120ms ease;

  &:hover {
    background: #dc3545;
    color: white;
  }

  &:active {
    opacity: 0.95;
  }

  @media (max-width: 720px) {
    flex: 1 1 0;
  }

  @media (hover: none) {
    &:hover {
      background: transparent;
      color: #dc3545;
    }
  }
`;

const HealthIndicator = styled.span<{ $healthy: boolean }>`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;

  padding: 0.3rem 0.65rem;
  border-radius: 999px;

  background: ${(p) => (p.$healthy ? '#d1fae5' : '#fee2e2')};
  color: ${(p) => (p.$healthy ? '#065f46' : '#991b1b')};

  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;

  &::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${(p) => (p.$healthy ? '#10b981' : '#ef4444')};
  }
`;

type NavProps = {
  dock?: NavDock;
};

const Nav: FC<NavProps> = ({ dock = 'top' }) => {
  const { user, logout } = useAuth();
  const isBackendHealthy = useBackendHealth();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <StyledNav $dock={dock}>
      <NavContainer>
        <NavBrand>
          <BrandName to={ROUTES.home.path}>
            <BrandText>carolinemizen.art</BrandText>
          </BrandName>
          {!isBackendHealthy && (
            <HealthIndicator $healthy={false}>API Down</HealthIndicator>
          )}
        </NavBrand>

        <Spacer />

        <NavLinks>
          <NavItemLink to={ROUTES.home.path}>Home</NavItemLink>
          <NavItemLink to={ROUTES.collections.path}>Collections</NavItemLink>
        </NavLinks>

        {user && (
          <>
            <Spacer />
            <NavRight>
              <NavItemLink to="/admin">Admin</NavItemLink>
              <LogoutButton onClick={handleLogout}>Logout</LogoutButton>
            </NavRight>
          </>
        )}
      </NavContainer>
    </StyledNav>
  );
};

export { Nav };
