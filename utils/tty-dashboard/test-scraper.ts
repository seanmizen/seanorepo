#!/usr/bin/env node
import {getTFLStatuses} from './source/tfl-scraper.js';

async function testScraper() {
	console.log('Testing TFL Status Scraper...');
	console.log('Fetching tube line statuses from TFL website...\n');

	try {
		const statuses = await getTFLStatuses();

		console.log(
			`Found ${statuses.length} tube lines with status information:\n`,
		);

		statuses.forEach((status, index) => {
			console.log(`${index + 1}. ${status.lineName}`);
			if (status.statusSeverity) {
				console.log(`   Status: ${status.statusSeverity}`);
			}
			if (status.affectedRoute) {
				console.log(`   Route: ${status.affectedRoute}`);
			}
			if (status.description) {
				const shortDesc =
					status.description.length > 100
						? status.description.substring(0, 100) + '...'
						: status.description;
				console.log(`   Description: ${shortDesc}`);
			}
			console.log('');
		});

		if (statuses.length === 0) {
			console.log(
				'⚠️  No tube lines found - the selector might need adjustment',
			);
		} else {
			console.log('✅ Scraper working successfully!');
		}
	} catch (error) {
		console.error('❌ Error running scraper:', error);
		process.exit(1);
	}
}

testScraper();
