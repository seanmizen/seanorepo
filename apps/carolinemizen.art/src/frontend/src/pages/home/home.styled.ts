import styled from 'styled-components';

export const LandingPage = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  width: '100vw',
});

export const Arrow = styled('button')<{ isVisible: boolean }>(({ isVisible }) => ({
  border: 'none',
  background: 'none',
  position: 'absolute',
  bottom: '40px',
  right: '22vw',
  transition: 'transform 500ms ease-in-out, opacity 800ms ease-in-out',
  transform: isVisible ? 'translateY(0)' : 'translateY(100px)',
  opacity: isVisible ? 1 : 0,
}));

export const HeroLinksWrapper = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  borderTop: '1px solid var(--border-color-secondary)',
  borderBottom: '1px solid var(--border-color-secondary)',
});

export const HeroLinksRow = styled('div')({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '5rem',

  height: '50vh',
  minHeight: '500px',
});

export const Body = styled('div')({
  whiteSpace: 'pre-wrap',
});
