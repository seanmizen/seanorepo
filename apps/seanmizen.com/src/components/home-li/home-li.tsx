import type { FC, ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Accordion } from '../accordion';
import styles from './home-li.module.css';

interface HomeLiProps {
  children: ReactNode;
  trigger: string;
  subLink?: string;
  setIsSnowing?: (isSnowing: boolean) => void;
}

const HomeLi: FC<HomeLiProps> = ({
  children,
  trigger,
  subLink,
  setIsSnowing,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const onFocus = () => setIsFocused(true);
  const onBlur = () => setIsFocused(false);
  const onMouseOver = () => setIsHovered(true);
  const onMouseOut = () => setIsHovered(false);

  const handleOpen = () => {
    if (trigger === 'Xmas 🎄') {
      setIsSnowing?.(true);
    }
  };

  const handleClose = () => {
    setIsSnowing?.(false);
  };

  const liClass = [
    styles.li,
    isFocused && styles['li-focused'],
    isHovered && styles['li-hover'],
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={liClass}
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseOver={onMouseOver}
      onMouseOut={onMouseOut}
    >
      <Accordion trigger={trigger} onOpen={handleOpen} onClose={handleClose}>
        {subLink && (
          <div className={styles.sublink}>
            <Link to={subLink}>visit</Link>
          </div>
        )}
        {children}
      </Accordion>
    </li>
  );
};

export { HomeLi };
