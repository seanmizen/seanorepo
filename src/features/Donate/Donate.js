import "./Donate.module.css";

function Donate() {
  return (
    <div>
      <div>
        <a
          tabIndex={0}
          role="listitem"
          aria-label="Monzo payment URL"
          href="https://monzo.me/seanmizen"
        >
          monzo.me/seanmizen
        </a>
      </div>
      <div
        tabIndex={0}
        role="listitem"
        aria-label="Bitcoin address"
        id="bitcoin"
      >
        bc1qr8vjxmrxqkzd9hu3z22vuhwe8kj55q8nvenkry
      </div>
      <div
        tabIndex={0}
        role="listitem"
        aria-label="Ethereum address"
        id="ethereum"
      >
        0x45c97B7D7c68efa8006471089066a746Ac117b71
      </div>
    </div>
  );
}

export default Donate;
