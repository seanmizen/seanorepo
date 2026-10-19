import type { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Accordion } from '@/components/accordion';
import { Entity, EntityList } from '@/components/entity-list';

interface HomeLiProps {
  children: ReactNode;
  trigger: string;
  subLink?: string;
  /** Says where the sublink goes. "visit" said nothing at all. */
  subLinkLabel?: string;
  /** Called when the section opens and closes. Keep these stable. */
  onOpen?: () => void;
  onClose?: () => void;
}

const HomeLi: FC<HomeLiProps> = ({
  children,
  trigger,
  subLink,
  subLinkLabel = 'see all',
  onOpen,
  onClose,
}) => (
  <Entity>
    <Accordion trigger={trigger} onOpen={onOpen} onClose={onClose}>
      {/*
        The sublink is an entity like any other, so it wears the same chevron
        as the rows beneath it and lines up with them. It used to be a bare
        div with a "→ " prefix, which put a second, unrelated arrow idiom
        directly above a list of chevrons.
      */}
      {subLink && (
        <EntityList>
          <Entity>
            <Link to={subLink}>{subLinkLabel}</Link>
          </Entity>
        </EntityList>
      )}
      {children}
    </Accordion>
  </Entity>
);

export { HomeLi };
