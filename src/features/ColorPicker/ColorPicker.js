import styles from "./ColorPicker.module.css";

function ColorPicker() {
  //  return <div className={styles["example"]}>I'm a color picker.</div>; flexContainer
  return (
    <div className={styles["flexRow"]}>
      <div className={styles["flexColumn"]}>
        <div>Background</div>
        <input
          onChange={(e) => {
            document.body.style.backgroundColor = e.target.value;
            document.getElementById("background-color").value = e.target.value;
          }}
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
            document.getElementById("text-color").value = e.target.value;
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
