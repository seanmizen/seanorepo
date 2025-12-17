import type { FC, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import styles from './accordion.module.css';

interface AccordionProps {
  trigger: string;
  children: ReactNode;
  defaultOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

const Accordion: FC<AccordionProps> = ({
  trigger,
  children,
  defaultOpen = false,
  onOpen,
  onClose,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const buttonId = useRef(
    `accordion-${Math.random().toString(36).slice(2, 9)}`,
  );
  const contentId = useRef(`content-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    if (isOpen) {
      onOpen?.();
    } else {
      onClose?.();
    }
  }, [isOpen, onOpen, onClose]);

  const toggle = () => setIsOpen(!isOpen);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };

  return (
    <div className={styles.accordion}>
      <button
        id={buttonId.current}
        type="button"
        className={styles.trigger}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        aria-expanded={isOpen}
        aria-controls={contentId.current}
      >
        {trigger}
      </button>
      <section
        id={contentId.current}
        ref={contentRef}
        className={`${styles.content} ${isOpen ? styles.open : styles.closed}`}
        aria-labelledby={buttonId.current}
        hidden={!isOpen}
      >
        <div className={styles.inner}>{children}</div>
      </section>
    </div>
  );
};

export { Accordion };
