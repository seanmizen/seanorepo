import { FC, useState } from 'react';
import { Image } from './lazy-load-image.styled';

interface LazyLoadImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  transition?: string;
}

const LazyLoadImage: FC<LazyLoadImageProps> = ({
  src,
  alt,
  width,
  height,
  transition,
  ...rest
}) => {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      onLoad={() => setIsLoaded(true)}
      isLoaded={isLoaded}
      transition={transition}
      {...rest}
    />
  );
};

export { LazyLoadImage };
export type { LazyLoadImageProps };
