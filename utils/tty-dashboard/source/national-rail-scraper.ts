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

  // Extract train departures from the results list
  const departures = await page.$$eval('ul.sc-f6950b8f-0 > li', (nodes) => {
    return nodes.map((node) => {
      // Scheduled time
      const scheduledTime =
        node.querySelector('.sc-68d26c6b-1.hobgaI')?.textContent?.trim() ?? '';

      // Expected time/status
      const statusElement = node.querySelector(
        '.sc-68d26c6b-2.hRMAvd, .sc-68d26c6b-2.fSGVGZ',
      );
      const statusText = statusElement?.textContent?.trim() ?? '';
      const isDelayed = statusElement?.classList.contains('hRMAvd') ?? false;

      // Extract expected time if delayed
      let expectedTime = scheduledTime;
      let status = statusText;
      if (statusText.startsWith('Expected ')) {
        expectedTime = statusText.replace('Expected ', '');
        status = 'Delayed';
      } else if (statusText === 'On time') {
        status = 'On time';
      }

      // Destination
      const destinationElement = node.querySelector('h3.sc-e490da6-0');
      const destinationFull =
        destinationElement
          ?.querySelector('.sc-e490da6-4')
          ?.textContent?.trim() ?? '';

      // Extract destination name and code
      const destinationMatch = destinationFull.match(/^(.+?)\(([A-Z]{3})\)$/);
      const destination = destinationMatch
        ? (destinationMatch[1]?.trim() ?? destinationFull)
        : destinationFull;
      const destinationCode = destinationMatch?.[2] ?? '';

      // Calling at
      const callingAtElement = node.querySelector('h4.sc-68d26c6b-7');
      const callingAt =
        callingAtElement?.textContent?.trim().replace('Calling at ', '') ?? '';

      // Platform
      const platform =
        node.querySelector('.sc-68d26c6b-5.MAkdk')?.textContent?.trim() ?? '';

      // Duration, stops, operator
      const metaElements = Array.from(
        node.querySelectorAll('.sc-dccf2f8a-1.hAgctT'),
      );

      let duration = '';
      let stops = '';
      let operator = '';

      metaElements.forEach((el, index) => {
        const text = el.textContent?.trim() ?? '';
        if (index === 0) {
          // First element is duration
          duration = text;
        } else if (text.includes('stop')) {
          // Element containing "stop" or "stops"
          stops = text;
        } else {
          // Remaining text is operator
          operator = text;
        }
      });

      // Delay reason
      const delayReason =
        node.querySelector('.sc-68d26c6b-17.lnzdlv')?.textContent?.trim() ??
        undefined;

      return {
        scheduledTime,
        expectedTime,
        status,
        destination,
        destinationCode,
        callingAt,
        platform,
        duration,
        stops,
        operator,
        delayReason,
        isDelayed,
      };
    });
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
    waitForSelector: 'ul.sc-f6950b8f-0',
    timeout: 30000,
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
