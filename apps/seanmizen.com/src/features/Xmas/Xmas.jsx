import styles from "./Xmas.module.css";

const presentLists = {
  Mum: [
    {
      title: "TODO",
    },
  ],
  "Mark, Chelsea, and Baby Dom": [
    {
      title: "TODO",
      // href: "https://www.amazon.co.uk/baby-reg/chelsea-zahramizen-mark-mizen-march-2025-reading/1S5T0W3JJIY58?ref_=cm_sw_r_apann_dp_XW3JVRJ8WTQJESYDBJ5J&language=en_US",
    },
  ],
  Sean: [
    {
      title: "Kitchen Tap",
      href: "https://amzn.eu/d/f3ux540",
      linklabel: "see here",
      description:
        "MUST HAVE:\n -separate hot/cold handle (not a mixer)\n -pull-out spray\n\n",
    },
    {
      title: "Impulse Labs induction hob",
      href: "https://www.impulselabs.com/product",
      linklabel: "see here",
    },
  ],
};

function Xmas() {
  return (
    <>
      <div className={`${styles["emoji-header"]}`}>🎅🎄👶🕯️🫏🐑🏚️</div>
      {Object.keys(presentLists).map((key, index) => (
        <>
          <div>{key}:</div>
          <ul className={`${styles["ul-link"]} ${styles["ul-padded-left"]}`}>
            {presentLists[key].map((present, index) => (
              <li key={index} style={{ whiteSpace: "pre-wrap" }}>
                {present.title}
                {present.href && (
                  <>
                    {" "}
                    -{" "}
                    <a
                      target="_blank"
                      tabIndex={0}
                      aria-label={present.arialabel}
                      href={present.href}
                    >
                      {present.linklabel}
                    </a>
                    {present.description && (
                      <>
                        <br />
                        <br />
                        {present.description}
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <br />
        </>
      ))}
    </>
  );
}

export default Xmas;
