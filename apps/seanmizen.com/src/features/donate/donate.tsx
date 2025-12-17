import type { FC } from 'react';
import styles from './donate.module.css';

const Donate: FC = () => {
  return (
    <div>
      <a aria-label="Monzo payment URL" href="https://monzo.me/seanmizen">
        monzo.me/seanmizen
      </a>
      <br />
      <label htmlFor="bitcoin" className="sr-only">
        Bitcoin address
      </label>
      <div
        className={styles['input-wrapper']}
        data-value="bc1qr8vjxmrxqkzd9hu3z22vuhwe8kj55q8nvenkry"
      >
        <input
          className={`mono ${styles['copy-input']}`}
          type="text"
          readOnly
          id="bitcoin"
          aria-label="Bitcoin address"
          value="bc1qr8vjxmrxqkzd9hu3z22vuhwe8kj55q8nvenkry"
        />
      </div>
      <br />
      <label htmlFor="ethereum" className="sr-only">
        Ethereum address
      </label>
      <div
        className={styles['input-wrapper']}
        data-value="0x45c97B7D7c68efa8006471089066a746Ac117b71"
      >
        <input
          className={`mono ${styles['copy-input']}`}
          type="text"
          readOnly
          id="ethereum"
          aria-label="Ethereum address"
          value="0x45c97B7D7c68efa8006471089066a746Ac117b71"
        />
      </div>
    </div>
  );
};

export { Donate };
