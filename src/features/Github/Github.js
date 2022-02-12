import moduleStyles from "./Github.module.css";
import globalStyles from "../../App.module.css";
import Code from "../../components/Code";
const styles = { ...moduleStyles, ...globalStyles };

function Github() {
  return (
    <div>
      <a
        tabIndex={0}
        role="listitem"
        aria-label="Github URL"
        href="https://github.com/seanmizen"
      >
        github.com/seanmizen
      </a>
      <div>
        <Code>i am testing out</Code>
        {/* <br />
          how to display code nicely
          <br /> */}
        {/* <CommandLine>echo yes &gt; myfile.txt</CommandLine> */}
      </div>
    </div>
  );
}

export default Github;
