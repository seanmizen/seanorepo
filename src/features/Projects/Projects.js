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
      <div>
        <a
          tabIndex={0}
          role="listitem"
          aria-label="URL for this website"
          href={process.env.PUBLIC_URL}
        >
          seanmizen.com
        </a>{" "}
        - this site!
      </div>
      <div>
        <a
          tabIndex={0}
          role="listitem"
          aria-label="URL for Tourguide-ar, a tourguide web app for universities. (a group work project)"
          href="https://tourguide-ar.github.io/Tourguide-ar/"
        >
          tourguide-ar
        </a>{" "}
        - a tourguide web app for universities (a WIP group project)
      </div>

      <div>last updated 2022-01-27</div>
    </div>
  );
}

export default Projects;
