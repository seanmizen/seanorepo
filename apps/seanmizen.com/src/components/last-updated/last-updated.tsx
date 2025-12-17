import { toWords } from 'number-to-words';
import type { FC } from 'react';
import { useEffect, useState } from 'react';
import styles from './last-updated.module.css';

const comfyTime = (dateTime: Date): string => {
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
      return 'around midnight';
  }

  const getHourStr = (h: number) => {
    if (h === 12) return 'midday';
    if (h === 24) return 'midnight';
    return toWords(((h - 1) % 12) + 1);
  };

  const hourStr = getHourStr(hour);
  const nextHourStr = getHourStr(nextHour);

  if (mins <= 15) return `at around ${hourStr} ${descriptor}`;
  if (mins <= 25) return `just after ${hourStr} ${descriptor}`;
  if (mins <= 35) return `at half ${hourStr}(ish)`;
  if (mins <= 50) return `at maybe ${nextHourStr} ${descriptor}`;
  return `just before ${nextHourStr} ${descriptor}`;
};

interface LastUpdatedProps {
  apiRepoUrl: string;
}

const LastUpdated: FC<LastUpdatedProps> = ({ apiRepoUrl }) => {
  const [lastUpdated, setLastUpdated] = useState(
    "at um, well, i'm not sure yet",
  );

  useEffect(() => {
    const fetchDate = async () => {
      try {
        const response = await fetch(apiRepoUrl);
        if (!response.ok)
          throw new Error(`HTTP error! Status: ${response.status}`);
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
    fetchDate();
  }, [apiRepoUrl]);

  return (
    <div className={styles['last-updated']} aria-live="polite">
      last updated {lastUpdated}
    </div>
  );
};

export { LastUpdated };
