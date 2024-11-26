function Donate() {
  return (
    <div>
      <a
        tabIndex={0}
        role="listitem"
        aria-label="Monzo payment URL"
        href="https://monzo.me/seanmizen"
      >
        monzo.me/seanmizen
      </a>
      <br />
      <span
        className={'mono'}
        tabIndex={0}
        role="listitem"
        aria-label="Bitcoin address"
        id="bitcoin"
      >
        bc1qr8vjxmrxqkzd9hu3z22vuhwe8kj55q8nvenkry
      </span>
      <br />
      <span
        className={'mono'}
        tabIndex={0}
        role="listitem"
        aria-label="Ethereum address"
        id="ethereum"
      >
        0x45c97B7D7c68efa8006471089066a746Ac117b71
      </span>
    </div>
  );
}

export default Donate;
