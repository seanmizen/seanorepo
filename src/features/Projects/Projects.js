import { useState, useEffect } from "react";
import "./Projects.module.css";
import toWords from "number-to-words/src/toWords";
//https://stackoverflow.com/questions/56279807/is-it-possible-to-automatically-have-the-last-updated-date-on-my-website-changed

const projectList = [
  {
    linklabel: "flash app",
    description: "a flashcarding app built in React",
    href: "/apps/flash-app",
    arialabel: "URL for Flash App, a flashcarding app built in react",
  },
  {
    linklabel: "tourguide-ar",
    description: "a tourguide web app for universities (a WIP group project)",
    href: process.env.PUBLIC_URL,
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

const comfyTime = (dateTime) => {
  const hour = dateTime.getUTCHours();
  const mins = dateTime.getUTCMinutes();
  const nextHour = hour + 1;
  let descriptor = "in the day";
  switch (hour) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      descriptor = "in the early morning";
      break;
    case 7:
    case 8:
    case 9:
    case 10:
    case 11:
      descriptor = "in the morning";
      break;
    case 12:
      //special case: midday
      return "at midday";
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
    case 19:
      descriptor = "in the afternoon";
      break;
    case 20:
    case 21:
    case 22:
      descriptor = "at night";
      break;
    default:
      //special case: midnight
      return "around midnight";
  }

  let hourStr = "";
  let nextHourStr = "";
  if (hour === 12) {
    hourStr = "midday";
  } else if (hour === 24) {
    hourStr = "midnight";
  } else {
    hourStr = toWords(((hour - 1) % 12) + 1);
  }
  if (nextHour === 12) {
    nextHourStr = "midday";
  } else if (nextHour === 24) {
    nextHourStr = "midnight";
  } else {
    nextHourStr = toWords(((nextHour - 1) % 12) + 1);
  }

  if (mins <= 15) {
    return "at around " + hourStr + " " + descriptor;
  } else if (mins <= 25) {
    return "just after " + hourStr + " " + descriptor;
  } else if (mins <= 35) {
    return "at half " + hourStr + "(ish)";
  } else if (mins <= 50) {
    return "at maybe " + nextHourStr + " " + descriptor;
  } else if (mins >= 50) {
    return "just before " + nextHourStr + " " + descriptor;
  }

  return 'at some time - but this stupid "timeToComfortableString" function is broken, lol';
};

function Projects({ verbose = false }) {
  const [lastUpdated, setLastUpdated] = useState("");

  useEffect(() => {
    sendRequestForDate();
  }, []);

  // TODO - elegant way to pull github repo name?
  const sendRequestForDate = () => {
    const xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function () {
      if (this.readyState === 4 && this.status === 200) {
        const repo = JSON.parse(this.responseText);
        const updatedDate = new Date(repo.pushed_at);
        let comfortableTime = comfyTime(updatedDate);

        setLastUpdated(
          updatedDate.toISOString().slice(0, 10) + " " + comfortableTime
        );
      }
    };
    xhttp.open(
      "GET",
      "https://api.github.com/repos/seanmizen/seanmizen.com-react",
      true
    );
    xhttp.send();
  };

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
      <div>last updated {lastUpdated}</div>
      {/* 
      section to test comfyTime:
      <br></br>
      <div>
        return(timeToComfortableString(randomDate()));
        {[...Array(100)].map((x, i) => (
          <div>
            {randomDate().toISOString().slice(0, 10) +
              " " +
              comfyTime(randomDate())}
          </div>
        ))}
      </div> */}
    </ul>
  );
}

export default Projects;
