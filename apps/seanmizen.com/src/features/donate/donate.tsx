import type { FC } from 'react';
import { Entity, EntityList } from '@/components';
import styles from './donate.module.css';

const BITCOIN_ADDRESS = 'bc1qr8vjxmrxqkzd9hu3z22vuhwe8kj55q8nvenkry';
const ETHEREUM_ADDRESS = '0x45c97B7D7c68efa8006471089066a746Ac117b71';

const Donate: FC = () => {
  return (
    <EntityList>
      <Entity>
        <a aria-label="Monzo payment URL" href="https://monzo.me/seanmizen">
          monzo.me/seanmizen
        </a>
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
