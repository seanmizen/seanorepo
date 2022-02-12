import moduleStyles from "./Donate.module.css";
import globalStyles from "../../App.module.css";
const styles = { ...moduleStyles, ...globalStyles };

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
        className={styles["mono"]}
        tabIndex={0}
        role="listitem"
        aria-label="Bitcoin address"
        id="bitcoin"
      >
        bc1qr8vjxmrxqkzd9hu3z22vuhwe8kj55q8nvenkry
      </div>
      <div
        className={styles["mono"]}
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
