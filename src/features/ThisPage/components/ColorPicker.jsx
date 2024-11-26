import { useState } from 'react';

import styles from '../ThisPage.module.css';

function ColorPicker() {
  const defaultBackgroundColor = '#EEEEEE';
  const defaultTextColor = '#000000';
  const [backgroundColor, setBackgroundColor] = useState(defaultBackgroundColor);
  const [textColor, setTextColor] = useState(defaultTextColor);

  const setBodyBackgroundColor = newColor => {
    setBackgroundColor(newColor);
    document.body.style.backgroundColor = newColor;
  };
  const setBodyTextColor = newColor => {
    setTextColor(newColor);
    document.body.style.color = newColor;
  };
  const resetBackgroundColor = () => {
    setBodyBackgroundColor(defaultBackgroundColor);
  };
  const resetTextColor = () => {
    setBodyTextColor(defaultTextColor);
  };

  return (
    <div className={styles.flexRow}>
      <div className={styles.flexColumn}>
        <div>background</div>
        <div className={styles.flexRow}>
          <input
            tabIndex={0}
            role="menu"
            aria-label="Background colour picker"
            onChange={e => setBodyBackgroundColor(e.target.value)}
            type="color"
            id="background-color"
            name="head"
            value={backgroundColor}
          />
          <button type="button" onClick={resetBackgroundColor}>
            reset
          </button>
        </div>
      </div>
      <div className={styles.flexColumn}>
        <div>text</div>
        <div className={styles.flexRow}>
          <input
            tabIndex={0}
            role="menu"
            aria-label="Page text colour picker"
            onChange={e => setBodyTextColor(e.target.value)}
            type="color"
            id="text-color"
            name="head"
            value={textColor}
          />
          <button type="button" onClick={resetTextColor}>
            reset
          </button>
        </div>
      </div>
    </div>
  );
}

export default ColorPicker;
