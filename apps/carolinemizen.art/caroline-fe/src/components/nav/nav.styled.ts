import styled from 'styled-components';

export const StyledNav = styled.nav`
  position: sticky;
  top: 0;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
`;

export const NavContainer = styled.div`
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 70px;
`;

export const NavBrand = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

export const NavLinks = styled.div`
  display: flex;
  align-items: center;
  gap: 2.5rem;

  @media (max-width: 768px) {
    gap: 1.5rem;
  }
`;

export const NavRight = styled.div`
  display: flex;
  align-items: center;
  gap: 2rem;
`;
