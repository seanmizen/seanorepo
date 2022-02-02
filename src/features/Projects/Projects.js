import "./Projects.module.css";
//https://stackoverflow.com/questions/56279807/is-it-possible-to-automatically-have-the-last-updated-date-on-my-website-changed

console.log(process.env.PUBLIC_URL);
const flashappURL =
  process.env.PUBLIC_URL === ""
    ? "http://seanmizen.com/apps/flash-app/"
    : "/apps/flash-app/";

const projectList = [
  {
    linklabel: "flash app",
    description: "a flashcarding app built in React",
    href: flashappURL,
    arialabel: "URL for Flash App, a flashcarding app built in react",
  },
  {
    linklabel: "tourguide-ar",
    description: "a tourguide web app for universities (a WIP group project)",
    href: "https://tourguide-ar.github.io/Tourguide-ar/",
    arialabel:
      "URL for Tourguide-ar, a tourguide web app for universities. (a group work project)",
  },
  {
    linklabel: "seanmizen.com",
    description: "this site",
    href: process.env.PUBLIC_URL,
    arialabel: "URL for this website",
  },
];

function Projects({ verbose = false }) {
  return (
    <ul>
      {projectList.map((project, index) => {
        return (
          <li key={index}>
            <a
              tabIndex={0}
              role="listitem"
              aria-label={project.arialabel}
              href={project.href}
            >
              {project.linklabel}
            </a>{" "}
            - {project.description}
          </li>
        );
      })}
    </ul>
  );
}

export default Projects;
