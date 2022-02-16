import Code from "../../components/Code";

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
        <Code content={"// i am testing out\n// how to display code nicely"} />
        <Code commandLine content={'screen -dm bash -c "yes > myfile.txt"'} />
      </div>
    </div>
  );
}

export default Github;
