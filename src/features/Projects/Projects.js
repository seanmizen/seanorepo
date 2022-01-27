import "./Projects.module.css";

function Projects() {
  return (
    <div>
      <div>
        <a
          tabIndex={0}
          role="listitem"
          aria-label="URL for Flash App, a flashcarding app built in react"
          href="/apps/flash-app"
        >
          flash app
        </a>{" "}
        - a flashcarding app built in React
      </div>
      <div>last updated 2022-01-27</div>
    </div>
  );
}

export default Projects;
