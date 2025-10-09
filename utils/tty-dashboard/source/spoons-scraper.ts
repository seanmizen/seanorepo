import puppeteer, {Browser, Page} from 'puppeteer';

export interface SpoonsPub {
	name: string;
	distance: string;
	address: string;
	openStatus: string;
	closingTime: string;
	facilities: string[];
	pubUrl: string;
	menuUrl: string;
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
	new Promise(resolve => setTimeout(resolve, ms));

// Extractor function for Wetherspoon pubs
async function extractSpoonsPubs(page: Page): Promise<SpoonsPub[]> {
	// Wait a bit more for the page to fully render
	await delay(2000);

	// Extract pub information from the listings
	const pubs = await page.$$eval('.filter-search-listings__item', articles => {
		return articles.map(article => {
			const name =
				article.querySelector('h3')?.textContent?.trim() ?? 'Unknown';

			const distance =
				article
					.querySelector('.filter-search-listings__distance')
					?.textContent?.trim() ?? '';

			const address =
				article
					.querySelector('.filter-search-listings__address')
					?.textContent?.trim()
					.replace(/Get directions.*$/, '')
					.trim() ?? '';

			const openStatus =
				article.querySelector('.open-status')?.textContent?.trim() ?? 'Unknown';

			const closingTime =
				article
					.querySelector('.opening-closing-time:not(.open-status)')
					?.textContent?.trim() ?? '';

			// Get facilities
			const facilityElements = Array.from(
				article.querySelectorAll('.filter-search-listings__facilities li'),
			);
			const facilities = facilityElements.map(
				el => el.textContent?.trim() ?? '',
			);

			// Get pub and menu URLs
			const pubUrlEl = article.querySelector(
				'.filter-search-listings__buttons .is-style-fill a',
			);
			const pubUrl = pubUrlEl?.getAttribute('href') ?? '';

			const menuUrlEl = article.querySelector(
				'.filter-search-listings__buttons .is-style-outline a',
			);
			const menuUrl = menuUrlEl?.getAttribute('href') ?? '';

			return {
				name,
				distance,
				address,
				openStatus,
				closingTime,
				facilities,
				pubUrl,
				menuUrl,
			};
		});
	});

	return pubs;
}

// High-level function to get Wetherspoon pubs for a location
export async function getSpoonsPubs(
	browser: Browser,
	location: string,
	lat?: number,
	lng?: number,
): Promise<SpoonsPub[]> {
	// Build URL with location and optional coordinates
	let url = `https://www.jdwetherspoon.com/pub-search/?location=${encodeURIComponent(
		location,
	)}`;
	if (lat !== undefined && lng !== undefined) {
		url += `&lat=${lat}&lng=${lng}`;
	}

	const config: ScraperConfig = {
		url,
		waitForSelector: '.filter-search-listings__list',
		timeout: 30000,
	};

	return await scrape(browser, config, extractSpoonsPubs);
}

// Test data for development
export const TEST_DATA: SpoonsPub[] = [
	{
		name: 'The Rocket',
		distance: 'Less than a mile away',
		address:
			'Putney Wharf Tower, Brewhouse Lane, Putney, Wandsworth, SW15 2JQ.',
		openStatus: 'Open',
		closingTime: 'Closes at 11:00 pm',
		facilities: [
			'Wifi',
			'TV Screens',
			'Licensed Outside Area',
			'Baby Change',
			'Meeting Facilities',
			'Step Free Access',
		],
		pubUrl: 'https://www.jdwetherspoon.com/pubs/the-rocket-putney/',
		menuUrl: 'https://www.jdwetherspoon.com/pub-menus/the-rocket-putney/',
	},
	{
		name: 'Walham Green',
		distance: '2.1 miles away',
		address: '472 Fulham Road, Fulham, Hammersmith & Fulham, SW6 1BY.',
		openStatus: 'Open',
		closingTime: 'Closes at 11:30 pm',
		facilities: [
			'Train Station',
			'Wifi',
			'TV Screens',
			'Licensed Outside Area',
			'Baby Change',
			'broadcasts Live News',
			'children Welcome',
		],
		pubUrl: 'https://www.jdwetherspoon.com/pubs/walham-green-fulham/',
		menuUrl: 'https://www.jdwetherspoon.com/pub-menus/walham-green-fulham/',
	},
];

// Convenience function that manages browser lifecycle
export async function getSpoonsData(
	location: string,
	lat?: number,
	lng?: number,
	useTestData = false,
): Promise<SpoonsPub[]> {
	if (useTestData) {
		return TEST_DATA;
	}

	const browser = await launchBrowser();
	try {
		return await getSpoonsPubs(browser, location, lat, lng);
	} finally {
		await closeBrowser(browser);
	}
}
