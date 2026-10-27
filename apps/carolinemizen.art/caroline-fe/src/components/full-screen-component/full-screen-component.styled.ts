import styled from 'styled-components';

export const FullScreenComponent = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  // Not 100vw: that includes the vertical scrollbar, and the page then
  // scrolls sideways on a system with a scrollbar that takes space.
  width: '100%',
});
