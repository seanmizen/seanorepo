import type { ChangeEvent, FC } from 'react';
import { useState } from 'react';
import styles from '../this-page.module.css';

const ColorPicker: FC = () => {
  const defaultBackgroundColor = '#EEEEEE';
  const defaultTextColor = '#000000';
  const [backgroundColor, setBackgroundColor] = useState(
    defaultBackgroundColor,
  );
  const [textColor, setTextColor] = useState(defaultTextColor);

  const setBodyBackgroundColor = (newColor: string) => {
    setBackgroundColor(newColor);
    document.body.style.backgroundColor = newColor;
  };

  const setBodyTextColor = (newColor: string) => {
    setTextColor(newColor);
    document.body.style.color = newColor;
  };

  const resetBackgroundColor = () =>
    setBodyBackgroundColor(defaultBackgroundColor);
  const resetTextColor = () => setBodyTextColor(defaultTextColor);

  return (
    <div className={styles.flexRow}>
      <div className={styles.flexColumn}>
        <label htmlFor="background-color">background</label>
        <div className={styles.flexRow}>
          <input
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setBodyBackgroundColor(e.target.value)
            }
            type="color"
            id="background-color"
            value={backgroundColor}
          />
          <button type="button" onClick={resetBackgroundColor}>
            reset
          </button>
        </div>
      </div>
      <div className={styles.flexColumn}>
        <label htmlFor="text-color">text</label>
        <div className={styles.flexRow}>
          <input
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setBodyTextColor(e.target.value)
            }
            type="color"
            id="text-color"
            value={textColor}
          />
          <button type="button" onClick={resetTextColor}>
            reset
          </button>
        </div>
      </div>
    </div>
  );
};

export { ColorPicker };
