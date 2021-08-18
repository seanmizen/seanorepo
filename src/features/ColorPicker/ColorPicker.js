import styles from "./ColorPicker.module.css";
//import { ChromePicker } from "react-color"; -- redacted: this. Semi-useful library but let's stick with the default <input> instead.

function ColorPicker() {
  const setBackgroundColor = (newColor) => {
    document.body.style.backgroundColor = newColor;
  };
  const setTextColor = (newColor) => {
    document.body.style.color = newColor;
  };
  const resetTextColor = () => {
    setTextColor("#000000");
  };
  const resetBackgroundColor = () => {
    setBackgroundColor("#EEEEEE");
  };

  return (
    <div className={styles["flexRow"]}>
      <div className={styles["flexColumn"]}>
        <div>Background</div>
        <div className={styles["flexRow"]}>
          <input
            onChange={(e) => setBackgroundColor(e.target.value)}
            type="color"
            id="background-color"
            name="head"
            value="#EEEEEE"
          />
          <button onClick={resetBackgroundColor}>Reset</button>
        </div>
      </div>
      <div className={styles["flexColumn"]}>
        <div>Text</div>
        <div className={styles["flexRow"]}>
          <input
            onChange={(e) => setTextColor(e.target.value)}
            type="color"
            id="text-color"
            name="head"
            value="#000000"
          />
          <button onClick={resetTextColor}>Reset</button>
        </div>
      </div>
    </div>
  );
}

export default ColorPicker;
