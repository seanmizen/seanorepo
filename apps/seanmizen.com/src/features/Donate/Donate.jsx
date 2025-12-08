import styles from './Donate.module.css';

function Donate() {
  return (
    <div>
      <a aria-label="Monzo payment URL" href="https://monzo.me/seanmizen">
        monzo.me/seanmizen
      </a>
      <br />
      <input
        className={`mono ${styles['copy-input']}`}
        type="text"
        readOnly
        id="bitcoin"
        aria-label="Bitcoin address"
        value="bc1qr8vjxmrxqkzd9hu3z22vuhwe8kj55q8nvenkry"
      />
      <br />
      <input
        className={`mono ${styles['copy-input']}`}
        type="text"
        readOnly
        id="ethereum"
        aria-label="Ethereum address"
        value="0x45c97B7D7c68efa8006471089066a746Ac117b71"
      />
    </div>
  );
}

export default Donate;
