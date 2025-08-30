function Todo() {
  return (
    <div>
      <ul>
        <li tabIndex={0}>implement some server-side code ✅</li>
        <li tabIndex={0}>add a database 🟨</li>
        <li tabIndex={0}>make some web requests ✅</li>
        <li tabIndex={0}>github contribution chart 🟨</li>
        <li tabIndex={0}>AI slop app</li>
        <li tabIndex={0}>
          <a href="https://huggingface.co/meta-llama">Llama</a>-on-phone for
          your auntie
        </li>
        <li tabIndex={0}>make the ui better (?)</li>
      </ul>
    </div>
  );
}

export default Todo;
