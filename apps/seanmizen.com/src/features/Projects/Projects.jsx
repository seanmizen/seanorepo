import styles from "./Projects.module.css";
// https://stackoverflow.com/questions/56279807/is-it-possible-to-automatically-have-the-last-updated-date-on-my-website-changed

const projectList = [
  // {
  //   linklabel: "flash app",
  //   description: "a flashcarding app built in React",
  //   href: flashappURL,
  //   arialabel: "URL for Flash App, a flashcarding app built in react",
  // },
  // {
  //   linklabel: "tourguide-ar",
  //   description: "a tourguide web app for universities (a WIP group project)",
  //   href: "https://tourguide-ar.github.io/Tourguide-ar/",
  //   arialabel:
  //     "URL for Tourguide-ar, a tourguide web app for universities. (a group work project)",
  // },
  {
    linklabel: "SeansCards.com",
    description: "Handwritten cards for sale - by me, for you",
    href: "https://seanscards.com",
    arialabel: "URL for SeansCards.com",
  },
  {
    linklabel: "seanmizen.com",
    description: "This site",
    // href: process.env.PUBLIC_URL,
    arialabel: "URL for this website",
  },
  {
    linklabel: "shist",
    description: "Super rad Shell History Tool",
    href: "https://github.com/seanmizen/shist",
    arialabel: "Github URL for shist",
  },
];

// TODO make a verbose version with iframes or previews of the projects.
// TODO alternate sides in verbose mode - each project is on the opposite side of the page
function Projects() {
  return (
    <ul className={`${styles["ul-link"]} ${styles["ul-padded-left"]}`}>
      {projectList.map((project, index) => (
        <li key={index}>
          <a
            tabIndex={0}
            aria-label={project.arialabel}
            href={project.href}
            target="_blank"
          >
            {project.linklabel}
          </a>
          - {project.description}
        </li>
      ))}
    </ul>
  );
}

export default Projects;
