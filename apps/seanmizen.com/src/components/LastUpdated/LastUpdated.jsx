import { toWords } from 'number-to-words';
import { useEffect, useState } from 'react';
import styles from './LastUpdated.module.css';

const comfyTime = (dateTime) => {
  const hour = dateTime.getUTCHours();
  const mins = dateTime.getUTCMinutes();
  const nextHour = hour + 1;
  let descriptor = 'in the day';
  switch (hour) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      descriptor = 'in the early morning';
      break;
    case 7:
    case 8:
    case 9:
    case 10:
    case 11:
      descriptor = 'in the morning';
      break;
    case 12:
      // special case: midday
      return 'at midday';
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
    case 19:
      descriptor = 'in the afternoon';
      break;
    case 20:
    case 21:
    case 22:
      descriptor = 'at night';
      break;
    default:
      // special case: midnight
      return 'around midnight';
  }

  let hourStr = '';
  let nextHourStr = '';
  if (hour === 12) {
    hourStr = 'midday';
  } else if (hour === 24) {
    hourStr = 'midnight';
  } else {
    hourStr = toWords(((hour - 1) % 12) + 1);
  }
  if (nextHour === 12) {
    nextHourStr = 'midday';
  } else if (nextHour === 24) {
    nextHourStr = 'midnight';
  } else {
    nextHourStr = toWords(((nextHour - 1) % 12) + 1);
  }

  if (mins <= 15) {
    return `at around ${hourStr} ${descriptor}`;
  }
  if (mins <= 25) {
    return `just after ${hourStr} ${descriptor}`;
  }
  if (mins <= 35) {
    return `at half ${hourStr}(ish)`;
  }
  if (mins <= 50) {
    return `at maybe ${nextHourStr} ${descriptor}`;
  }
  if (mins >= 50) {
    return `just before ${nextHourStr} ${descriptor}`;
  }

  return 'at some time - but this stupid "comfyTimeString" function is broken, lol';
};

function LastUpdated({ apiRepoUrl }) {
  const [lastUpdated, setLastUpdated] = useState(
    "at um, well, i'm not sure yet",
  );

  const sendRequestForDate = async () => {
    try {
      const response = await fetch(apiRepoUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const repo = await response.json();
      const updatedDate = new Date(repo.pushed_at);
      const comfortableTime = comfyTime(updatedDate);

      setLastUpdated(
        `${updatedDate.toISOString().slice(0, 10)} ${comfortableTime}`,
      );
    } catch (error) {
      console.error('Failed to fetch repository data:', error);
    }
  };

  useEffect(() => {
    sendRequestForDate();
  }, []);

  return (
    <div className={styles['last-updated']}>last updated {lastUpdated}</div>
  );
}

export default LastUpdated;
