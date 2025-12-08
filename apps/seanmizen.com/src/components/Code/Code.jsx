import './Code.module.css';

function Code({ content, commandLine }) {
  return (
    <pre>
      <code>
        {!commandLine
          ? content
          : content
              .split('\n')
              .map((item) => <span key={item}>{`${item}\n`}</span>)}
      </code>
    </pre>
  );
}

export default Code;
