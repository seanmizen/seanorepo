import puppeteer, { type Browser, type Page } from 'puppeteer';

export interface TubeLineStatus {
  lineName: string;
  statusSeverity: string;
  affectedRoutes: string[];
  description: string;
}

export interface StationStatus {
  stationName: string;
  statusSeverity: string;
  affectedRoutes: string[];
  description: string;
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

// Extractor function for tube line statuses
async function extractTubeLineStatuses(page: Page): Promise<TubeLineStatus[]> {
  // Wait a bit more for the PWA to fully render
  await delay(2000);

  // Extract tube line statuses from the disruptions-list container
  const tubeLines = await page.$$eval(
    '.disruptions-list [data-testid="headles-accordion-root-testid"]',
    (nodes) => {
      return nodes.map((node) => {
        const lineName =
          node
            .querySelector('[data-testid="accordion-name"]')
            ?.textContent?.trim() ?? '';
        const statusSeverity =
          node
            .querySelector('[data-testid="line-status"]')
            ?.textContent?.trim() ?? '';

        // Get all affected routes
        const affectedRouteElements = Array.from(
          node.querySelectorAll('[data-testid="line-affected-route"]'),
        );

        const affectedRoutes = affectedRouteElements.map((routeEl) => {
          // Get the paragraph element with route info
          const paragraph = routeEl.querySelector(
            '[data-test-id="directionInfo"]',
          );
          if (!paragraph) return routeEl.textContent?.trim() ?? '';

          // Get all text nodes and the span separately
          const childNodes = Array.from(paragraph.childNodes);
          const textParts: string[] = [];

          childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent?.trim();
              if (text) textParts.push(text);
            }
          });

          // Join the locations with the double arrow
          return textParts.join(' ↔ ');
        });

        const description =
          node
            .querySelector('[data-testid="accordion-panel"]')
            ?.textContent?.trim() ?? '';

        return {
          lineName,
          statusSeverity,
          affectedRoutes,
          description,
        };
      });
    },
  );

  return tubeLines;
}

// Extractor function for station statuses
async function extractStationStatuses(page: Page): Promise<StationStatus[]> {
  // Wait a bit more for the PWA to fully render
  await delay(2000);

  // Extract station statuses from the station-disruptions-list container
  const stations = await page.$$eval(
    '.station-disruptions-list [data-testid="headles-accordion-root-testid"]',
    (nodes) => {
      return nodes.map((node) => {
        const stationName =
          node
            .querySelector('[data-testid="accordion-name"]')
            ?.textContent?.trim() ?? '';
        const statusSeverity =
          node
            .querySelector('[data-testid="line-status"]')
            ?.textContent?.trim() ?? '';

        // Get all affected routes
        const affectedRouteElements = Array.from(
          node.querySelectorAll('[data-testid="line-affected-route"]'),
        );

        const affectedRoutes = affectedRouteElements.map((routeEl) => {
          // Get the paragraph element with route info
          const paragraph = routeEl.querySelector(
            '[data-test-id="directionInfo"]',
          );
          if (!paragraph) return routeEl.textContent?.trim() ?? '';

          // Get all text nodes and the span separately
          const childNodes = Array.from(paragraph.childNodes);
          const textParts: string[] = [];

          childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent?.trim();
              if (text) textParts.push(text);
            }
          });

          // Join the locations with the double arrow
          return textParts.join(' ↔ ');
        });

        const description =
          node
            .querySelector('[data-testid="accordion-panel"]')
            ?.textContent?.trim() ?? '';

        return {
          stationName,
          statusSeverity,
          affectedRoutes,
          description,
        };
      });
    },
  );

  return stations;
}

// High-level function to get tube line statuses
export async function getTubeLineStatuses(
  browser: Browser,
): Promise<TubeLineStatus[]> {
  const config: ScraperConfig = {
    url: 'https://tfl.gov.uk/tube-dlr-overground/status',
    waitForSelector: '.disruptions-list',
    timeout: 30000,
  };

  return await scrape(browser, config, extractTubeLineStatuses);
}

// High-level function to get station statuses
export async function getStationStatuses(
  browser: Browser,
): Promise<StationStatus[]> {
  const config: ScraperConfig = {
    url: 'https://tfl.gov.uk/tube-dlr-overground/status',
    waitForSelector: '.station-disruptions-list',
    timeout: 30000,
  };

  return await scrape(browser, config, extractStationStatuses);
}

// Test data for development
export const TEST_DATA: TubeLineStatus[] = [
  {
    lineName: 'DLR',
    statusSeverity: 'Minor delays',
    affectedRoutes: [
      'Poplar ↔ Tower Gateway',
      'Canary Wharf ↔ Bank',
      'West India Quay ↔ Canary Wharf',
    ],
    description: 'DLR: Minor delays due to an earlier signal failure.',
  },
  {
    lineName: 'Victoria',
    statusSeverity: 'Severe delays',
    affectedRoutes: ['Entire line'],
    description:
      'Victoria Line: Severe delays due to an earlier points failure at Walthamstow Central. London Buses, London Overground, Great Northern, Thameslink, Greater Anglia, South Western Railway and Southeastern are accepting tickets via any reasonable route.',
  },
];

// Convenience function that manages browser lifecycle
export async function getTFLStatuses(
  useTestData = false,
): Promise<TubeLineStatus[]> {
  if (useTestData) {
    return TEST_DATA;
  }

  const browser = await launchBrowser();
  try {
    return await getTubeLineStatuses(browser);
  } finally {
    await closeBrowser(browser);
  }
}
