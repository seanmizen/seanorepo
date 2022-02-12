import moduleStyles from "./Code.module.css";
import globalStyles from "../../App.module.css";
const styles = { ...moduleStyles, ...globalStyles };

function Code({ children }) {
  return <p className={styles["code"]}>{children}</p>;
}

//JSON.stringify?

// function CommandLine({ children }) {
//   return (
//     <p className={styles["code"] + " " + styles["command-line"]}>{children}</p>
//   );
// }

//TODO get all of this messy stuff working

// const exports = { Code, CommandLine };
// export default exports;
export default Code;
