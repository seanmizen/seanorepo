import type { FC } from 'react';
import { Entity, EntityList, ExternalLink } from '@/components';
import styles from './donate.module.css';

const BITCOIN_ADDRESS = 'bc1qr8vjxmrxqkzd9hu3z22vuhwe8kj55q8nvenkry';
const ETHEREUM_ADDRESS = '0x45c97B7D7c68efa8006471089066a746Ac117b71';

const Donate: FC = () => {
  return (
    <EntityList>
      <Entity>
        {/* Was aria-label="Monzo payment URL" over link text reading
            "monzo.me/seanmizen" — the third instance of the same WCAG 2.5.3
            mismatch, after the projects list and the github feature. */}
        <ExternalLink href="https://monzo.me/seanmizen">
          monzo.me/seanmizen
        </ExternalLink>
      </Entity>
      <Entity>
        <label htmlFor="bitcoin" className="sr-only">
          Bitcoin address
        </label>
        <div className={styles['input-wrapper']} data-value={BITCOIN_ADDRESS}>
          <input
            className={`mono ${styles['copy-input']}`}
            type="text"
            readOnly
            id="bitcoin"
            aria-label="Bitcoin address"
            value={BITCOIN_ADDRESS}
          />
        </div>
      </Entity>
      <Entity>
        <label htmlFor="ethereum" className="sr-only">
          Ethereum address
        </label>
        <div className={styles['input-wrapper']} data-value={ETHEREUM_ADDRESS}>
          <input
            className={`mono ${styles['copy-input']}`}
            type="text"
            readOnly
            id="ethereum"
            aria-label="Ethereum address"
            value={ETHEREUM_ADDRESS}
          />
        </div>
      </Entity>
    </EntityList>
  );
};

export { Donate };
