import "./Code.module.css";

function Code({ content, commandLine }) {
  return (
    <pre>
      <code>
        {!commandLine
          ? content
          : content
              .split("\n")
              .map((item, i) => <span key={i}>{item + "\n"}</span>)}
      </code>
    </pre>
  );
}

export default Code;
