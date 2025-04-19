import styled from 'styled-components';

export const Image = styled('img')<{ isLoaded: boolean; transition?: string }>(
  ({ isLoaded, transition }) => ({
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: isLoaded ? 1 : 0,
    transition: transition || 'opacity 300ms ease-in-out',
  }),
);
