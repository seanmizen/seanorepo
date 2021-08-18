import styles from "./ColorPicker.module.css";
//import { ChromePicker } from "react-color"; -- redacted: this. Semi-useful library but let's stick with the default <input> instead.

function ColorPicker() {
  const setBackgroundColor = (newColor) => {
    document.body.style.backgroundColor = newColor.target.value;
  };
  const setTextColor = (newColor) => {
    document.body.style.color = newColor.target.value;
  };

  return (
    <div className={styles["flexRow"]}>
      <div className={styles["flexColumn"]}>
        <div>Background</div>
        <input
          onChange={(e) => setBackgroundColor(e)}
          type="color"
          id="background-color"
          name="head"
          value="#EEEEEE"
        />
      </div>
      <div className={styles["flexColumn"]}>
        <div>Text</div>
        <input
          onChange={(e) => {
            document.body.style.color = e.target.value;
            document.getElementById("background-color").value = e.target.value;
          }}
          type="color"
          id="text-color"
          name="head"
          value="#000000"
        />
      </div>
    </div>
  );
}

export default ColorPicker;
