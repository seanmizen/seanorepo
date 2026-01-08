import type { FC, ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '@/contexts/auth-context';
import { DebugMenu } from '../debug-menu';

const LayoutContainer = styled.div`
  display: flex;
  min-height: 100vh;
`;

const Sidebar = styled.aside`
  width: 250px;
  background: #2c3e50;
  color: white;
  padding: 1.5rem 0;
  display: flex;
  flex-direction: column;
`;

const SidebarHeader = styled.div`
  padding: 0 1.5rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  margin-bottom: 1.5rem;
`;

const SidebarTitle = styled.h1`
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
`;

const SidebarUser = styled.div`
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 0.5rem;
`;

const LogoutButton = styled.button`
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
`;

const Nav = styled.nav`
  flex: 1;
`;

const NavSection = styled.div`
  margin-bottom: 1.5rem;
`;

const NavSectionTitle = styled.h2`
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.5);
  padding: 0 1.5rem;
  margin: 0 0 0.75rem;
  font-weight: 600;
`;

const NavItem = styled(NavLink)`
  display: block;
  padding: 0.75rem 1.5rem;
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  &.active {
    background: rgba(255, 255, 255, 0.15);
    color: white;
    border-left: 3px solid #3498db;
    padding-left: calc(1.5rem - 3px);
  }
`;

const Main = styled.main`
  flex: 1;
  background: #f5f5f5;
  overflow-y: auto;
`;

const _MainHeader = styled.header`
  background: white;
  padding: 1.5rem 2rem;
  border-bottom: 1px solid #e0e0e0;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
`;

const MainContent = styled.div`
  padding: 2rem;
`;

interface AdminLayoutProps {
  children?: ReactNode;
}

export const AdminLayout: FC<AdminLayoutProps> = ({ children }) => {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <LayoutContainer>
      <Sidebar>
        <SidebarHeader>
          <SidebarTitle>Admin Panel</SidebarTitle>
          <SidebarUser>{user?.email}</SidebarUser>
          <Link
            to="/"
            style={{
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '0.85rem',
              marginRight: '1rem',
            }}
          >
            View Site
          </Link>
          <LogoutButton type="button" onClick={handleLogout}>
            Logout
          </LogoutButton>
        </SidebarHeader>

        <Nav>
          <NavSection>
            <NavSectionTitle>Overview</NavSectionTitle>
            <NavItem to="/admin/dashboard">Dashboard</NavItem>
          </NavSection>

          <NavSection>
            <NavSectionTitle>Content</NavSectionTitle>
            <NavItem to="/admin/artworks">Artworks</NavItem>
            <NavItem to="/admin/galleries">Galleries</NavItem>
            <NavItem to="/admin/images">Images</NavItem>
          </NavSection>

          <NavSection>
            <NavSectionTitle>Site</NavSectionTitle>
            <NavItem to="/admin/content">Site Content</NavItem>
          </NavSection>
        </Nav>
      </Sidebar>

      <Main>
        <MainContent>{children || <Outlet />}</MainContent>
      </Main>

      <DebugMenu />
    </LayoutContainer>
  );
};
