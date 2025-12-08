import type { FC } from 'react';
import type { LinkProps } from 'react-router-dom';
import { LazyLoadImage, type LazyLoadImageProps } from '..';
import {
  Description,
  IconRow,
  IconWrapper,
  ImageContainer,
  Title,
  Wrapper,
} from './preview-card.styled';

interface PreviewCardProps extends LinkProps {
  title?: string;
  description?: string;
  imageProps?: LazyLoadImageProps;
  icons?: string[];
}

// TODO: replace with SVGs
const iconsExample = [
  'https://picsum.photos/30/30',
  'https://picsum.photos/31/31',
  'https://picsum.photos/32/32',
  'https://picsum.photos/32/32',
];

const imagePropsExample: LazyLoadImageProps = {
  src: 'https://picsum.photos/300/300',
  alt: 'Gallery preview image',
};

const PreviewCard: FC<PreviewCardProps> = ({
  title,
  description,
  imageProps = imagePropsExample,
  icons = iconsExample,
  ...rest
}) => {
  return (
    <Wrapper {...rest}>
      {title && <Title>{title}</Title>}
      {description && <Description>{description}</Description>}
      {imageProps && (
        <ImageContainer>
          <LazyLoadImage {...imageProps} />
        </ImageContainer>
      )}
      {icons?.length && (
        <IconRow>
          {icons.map((icon) => (
            <IconWrapper key={icon}>
              <img src={icon} width={50} alt="icon" />
            </IconWrapper>
          ))}
        </IconRow>
      )}
    </Wrapper>
  );
};

export { PreviewCard };
export type { PreviewCardProps };
