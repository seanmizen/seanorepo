import styles from "./LastUpdated.module.css";
import toWords from "number-to-words/src/toWords";
import { useState, useEffect } from "react";

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

  return 'at some time - but this stupid "comfyTimeString" function is broken, lol';
};

const LastUpdated = ({ apiRepoUrl }) => {
  const [lastUpdated, setLastUpdated] = useState(
    "at um, well, i'm not sure yet"
  );

  useEffect(() => {
    sendRequestForDate();
  });

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
    xhttp.open("GET", apiRepoUrl, true);
    xhttp.send();
  };

  return (
    <div className={styles["last-updated"]}>last updated {lastUpdated}</div>
  );
};

export default LastUpdated;
