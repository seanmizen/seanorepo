import puppeteer, { type Browser, type Page } from 'puppeteer';

export interface TrainDeparture {
  scheduledTime: string;
  expectedTime: string;
  status: string; // "On time", "Expected 10:00", etc.
  destination: string;
  destinationCode: string;
  callingAt: string;
  platform: string;
  duration: string;
  stops: string;
  operator: string;
  delayReason?: string;
  isDelayed: boolean;
}

export interface ScraperConfig {
  url: string;
  waitForSelector?: string;
  timeout?: number;
  headless?: boolean;
}

// Internal interface for the National Rail JSON API structure
interface NationalRailService {
  departureInfo?: {
    scheduled: string | null;
    estimated: string | null;
  };
  status?: {
    status: string;
    delay?: string;
  };
  destination?: Array<{
    locationName: string;
    crs: string;
  }>;
  platform?: string;
  operator?: {
    name: string;
  };
  journeyDetails?: {
    stops: number;
    departureInfo?: {
      scheduled: string | null;
    };
    arrivalInfo?: {
      scheduled: string | null;
    };
  };
}

// Browser lifecycle functions
export async function launchBrowser(headless = true): Promise<Browser> {
  return await puppeteer.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

export async function closeBrowser(browser: Browser): Promise<void> {
  await browser.close();
}

// Core scraping function
export async function scrape<T>(
  browser: Browser,
  config: ScraperConfig,
  extractor: (page: Page) => Promise<T>,
): Promise<T> {
  const page = await browser.newPage();

  try {
    await page.goto(config.url, {
      waitUntil: 'networkidle2',
      timeout: config.timeout ?? 30000,
    });

    // Wait for selector if provided
    if (config.waitForSelector) {
      await page.waitForSelector(config.waitForSelector, {
        timeout: config.timeout ?? 30000,
      });
    }

    // Execute the custom extractor function
    const result = await extractor(page);

    return result;
  } finally {
    await page.close();
  }
}

// Helper function to delay execution
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Extractor function for train departures
async function extractTrainDepartures(page: Page): Promise<TrainDeparture[]> {
  // Wait a bit more for the page to fully render
  await delay(2000);

  // Extract JSON data from Next.js data
  const departures = await page.evaluate(() => {
    // Try to find __NEXT_DATA__ script tag (Next.js standard)
    const nextDataScript = document.getElementById('__NEXT_DATA__');

    if (nextDataScript?.textContent) {
      try {
        const nextData = JSON.parse(nextDataScript.textContent);
        const liveTrainsState = nextData?.props?.pageProps?.liveTrainsState;

        // Data is in React Query hydration format
        const queryData = liveTrainsState?.queries?.[0]?.state?.data;
        const services = queryData?.pages?.[0]?.services || [];

        if (services.length > 0) {
          return services.map((service: NationalRailService) => {
            // Parse times from ISO format
            const parseTime = (
              isoString: string | null | undefined,
            ): string => {
              if (!isoString) return '';
              const date = new Date(isoString);
              return date.toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              });
            };

            // Calculate duration
            const calculateDuration = (
              departure: string | null | undefined,
              arrival: string | null | undefined,
            ): string => {
              if (!departure || !arrival) return '';
              const depTime = new Date(departure);
              const arrTime = new Date(arrival);
              const diffMs = arrTime.getTime() - depTime.getTime();
              const diffMins = Math.floor(diffMs / 60000);
              const hours = Math.floor(diffMins / 60);
              const mins = diffMins % 60;
              if (hours > 0) {
                return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
              }
              return `${mins}m`;
            };

            const scheduledTime = parseTime(service.departureInfo?.scheduled);
            const estimatedTime = parseTime(service.departureInfo?.estimated);
            const statusValue = service.status?.status || 'Unknown';
            const isDelayed = statusValue !== 'OnTime';

            // Format status for display
            let status = statusValue;
            if (statusValue === 'OnTime') {
              status = 'On time';
            } else if (isDelayed && estimatedTime !== scheduledTime) {
              status = 'Delayed';
            }

            const destination = service.destination?.[0]?.locationName || '';
            const destinationCode = service.destination?.[0]?.crs || '';
            const platform = service.platform || '';
            const operator = service.operator?.name || '';

            // Format stops
            const stopCount = service.journeyDetails?.stops;
            const stops =
              stopCount !== undefined
                ? `${stopCount} stop${stopCount !== 1 ? 's' : ''}`
                : '';

            // Calculate duration from journey details
            const duration = calculateDuration(
              service.journeyDetails?.departureInfo?.scheduled,
              service.journeyDetails?.arrivalInfo?.scheduled,
            );

            // Delay reason
            const delayReason = service.status?.delay || undefined;

            return {
              scheduledTime,
              expectedTime: estimatedTime,
              status,
              destination,
              destinationCode,
              callingAt: '', // No longer available in new site structure
              platform,
              duration,
              stops,
              operator,
              delayReason,
              isDelayed,
            };
          });
        }
      } catch (error) {
        console.error('Failed to parse __NEXT_DATA__:', error);
      }
    }

    // Fallback: data not found
    return [];
  });

  return departures;
}

// High-level function to get train departures for a station
export async function getTrainDepartures(
  browser: Browser,
  stationName: string,
): Promise<TrainDeparture[]> {
  const config: ScraperConfig = {
    url: `https://www.nationalrail.co.uk/live-trains/departures/${stationName}`,
    waitForSelector: 'script', // Wait for page scripts to load
    timeout: 100000,
  };

  return await scrape(browser, config, extractTrainDepartures);
}

// Test data for development
export const TEST_DATA: TrainDeparture[] = [
  {
    scheduledTime: '09:59',
    expectedTime: '10:00',
    status: 'Delayed',
    destination: 'London Waterloo',
    destinationCode: 'WAT',
    callingAt: 'Putney',
    platform: '1',
    duration: '17m',
    stops: '5 stops',
    operator: 'South Western Railway',
    delayReason: 'This service is running late',
    isDelayed: true,
  },
  {
    scheduledTime: '10:04',
    expectedTime: '10:04',
    status: 'On time',
    destination: 'London Waterloo',
    destinationCode: 'WAT',
    callingAt: 'Putney',
    platform: '2',
    duration: '17m',
    stops: '3 stops',
    operator: 'South Western Railway',
    isDelayed: false,
  },
  {
    scheduledTime: '10:08',
    expectedTime: '10:09',
    status: 'Delayed',
    destination: 'London Waterloo',
    destinationCode: 'WAT',
    callingAt: 'Putney',
    platform: '1',
    duration: '21m',
    stops: '5 stops',
    operator: 'South Western Railway',
    delayReason: 'This service is running late',
    isDelayed: true,
  },
  {
    scheduledTime: '10:08',
    expectedTime: '10:08',
    status: 'On time',
    destination: 'Weybridge',
    destinationCode: 'WYB',
    callingAt: 'Putney',
    platform: '3',
    duration: '1h',
    stops: '16 stops',
    operator: 'South Western Railway',
    isDelayed: false,
  },
  {
    scheduledTime: '10:14',
    expectedTime: '10:14',
    status: 'On time',
    destination: 'London Waterloo',
    destinationCode: 'WAT',
    callingAt: 'Putney',
    platform: '1',
    duration: '16m',
    stops: '4 stops',
    operator: 'South Western Railway',
    isDelayed: false,
  },
  {
    scheduledTime: '10:16',
    expectedTime: '10:16',
    status: 'On time',
    destination: 'Kingston',
    destinationCode: 'KNG',
    callingAt: 'Putney',
    platform: '3',
    duration: '1h 3m',
    stops: '18 stops',
    operator: 'South Western Railway',
    isDelayed: false,
  },
  {
    scheduledTime: '10:17',
    expectedTime: '10:17',
    status: 'On time',
    destination: 'Windsor & Eton Riverside',
    destinationCode: 'WNR',
    callingAt: 'Putney',
    platform: '4',
    duration: '42m',
    stops: '10 stops',
    operator: 'South Western Railway',
    isDelayed: false,
  },
  {
    scheduledTime: '10:22',
    expectedTime: '10:22',
    status: 'On time',
    destination: 'London Waterloo',
    destinationCode: 'WAT',
    callingAt: 'Putney',
    platform: '1',
    duration: '17m',
    stops: '4 stops',
    operator: 'South Western Railway',
    isDelayed: false,
  },
  {
    scheduledTime: '10:29',
    expectedTime: '10:35',
    status: 'Delayed',
    destination: 'London Waterloo',
    destinationCode: 'WAT',
    callingAt: 'Putney',
    platform: '1',
    duration: '17m',
    stops: '5 stops',
    operator: 'South Western Railway',
    delayReason:
      'This train has been delayed by the communication alarm being activated on a train',
    isDelayed: true,
  },
  {
    scheduledTime: '10:34',
    expectedTime: '10:34',
    status: 'On time',
    destination: 'London Waterloo',
    destinationCode: 'WAT',
    callingAt: 'Putney',
    platform: '2',
    duration: '15m',
    stops: '3 stops',
    operator: 'South Western Railway',
    isDelayed: false,
  },
];

// Convenience function that manages browser lifecycle
export async function getNationalRailDepartures(
  stationName: string,
  useTestData = false,
): Promise<TrainDeparture[]> {
  if (useTestData) {
    return TEST_DATA;
  }

  const browser = await launchBrowser();
  try {
    return await getTrainDepartures(browser, stationName);
  } finally {
    await closeBrowser(browser);
  }
}
