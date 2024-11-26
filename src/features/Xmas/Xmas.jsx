import styles from './Xmas.module.css';
// https://stackoverflow.com/questions/56279807/is-it-possible-to-automatically-have-the-last-updated-date-on-my-website-changed

const presentList = [
  {
    description: 'Wine Glasses',
    href: 'https://www.next.co.uk/style/st854053/t59512?gad_source=1&gclid=Cj0KCQiA_9u5BhCUARIsABbMSPuVUjjO-BqknZ-l0i_B6XwQnO0lgZimzcBPb68wRsUn4YWTWklAmdgaAoEAEALw_wcB&gclsrc=aw.ds#T59512',
    linklabel: 'e.g. Next',
  },
  {
    description: "Comfyballs - Men's Cotton Boxer Briefs",
    href: 'https://www.comfyballs.co.uk/product-category/mens/comfyballs-cotton-mens-underwear/',
    linklabel: 'see here',
  },
];

function Xmas() {
  return (
    <>
      <div>Sean:</div>
      <ul className={`${styles['ul-link']} ${styles['ul-padded-left']}`}>
        {presentList.map((present, index) => (
          <li key={index}>
            {present.description}
            {present.href && (
              <>
                {' '}
                -
                <a tabIndex={0} aria-label={present.arialabel} href={present.href}>
                  {present.linklabel}
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export default Xmas;
