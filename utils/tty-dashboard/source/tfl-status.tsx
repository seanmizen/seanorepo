import React, {useState, useEffect, FC} from 'react';
import {Text, Box} from 'ink';
import {getTFLStatuses, TubeLineStatus} from './tfl-scraper.js';

const lineColors: Record<string, string> = {
	Bakerloo: '#B36305',
	Central: '#E32017',
	Circle: '#FFD300',
	District: '#00782A',
	Elizabeth: '#6950a1',
	'Hammersmith & City': '#F3A9BB',
	Jubilee: '#A0A5A9',
	Metropolitan: '#9B0056',
	Northern: '#000000',
	Piccadilly: '#003688',
	Victoria: '#0098D4',
	'Waterloo & City': '#95CDBA',
	DLR: '#00A4A7',
	'London Overground': '#EE7C0E',
	'London Trams': '#84B817',
	'Emirates Cable Car': '#E21836',
};

// TTY-compatible ANSI color names
const lineColorsTTY: Record<string, string> = {
	Bakerloo: 'yellow',
	Central: 'red',
	Circle: 'yellow',
	District: 'green',
	Elizabeth: 'magenta',
	'Hammersmith & City': 'magentaBright',
	Jubilee: 'gray',
	Metropolitan: 'magenta',
	Northern: 'white',
	Piccadilly: 'blue',
	Victoria: 'cyan',
	'Waterloo & City': 'cyan',
	DLR: 'cyan',
	'London Overground': 'yellow',
	'London Trams': 'green',
	'Emirates Cable Car': 'red',
};

// Special indicators for lines that need different symbols in TTY
const lineIndicatorsTTY: Record<string, string> = {
	Northern: '▢▢', // Empty box character - visible white outline on black
};

const getLineColor = (lineName: string, isTTY: boolean): string => {
	if (isTTY) {
		return lineColorsTTY[lineName] || 'white';
	}
	return lineColors[lineName] || '#FFFFFF';
};

const getLineIndicator = (lineName: string, isTTY: boolean): string => {
	if (isTTY && lineIndicatorsTTY[lineName]) {
		return lineIndicatorsTTY[lineName];
	}
	return '▬▬';
};

const getStatusColor = (status: string): string => {
	const statusLower = status.toLowerCase();
	if (statusLower.includes('good service')) return 'green';
	if (statusLower.includes('minor delays')) return 'yellow';
	if (statusLower.includes('severe delays')) return 'red';
	if (
		statusLower.includes('part closure') ||
		statusLower.includes('part suspended')
	)
		return 'red';
	if (statusLower.includes('closed') || statusLower.includes('suspended'))
		return 'red';
	return 'white';
};

type Props = {
	width?: string | number;
	height?: string | number;
	refreshInterval?: number; // poll interval, in seconds
	countdownInterval?: number; // screen refresh interval, in seconds
	useTestData?: boolean;
	showDescription?: boolean;
	isTTY?: boolean;
	minHeight?: string | number;
};

export const TFLStatus: FC<Props> = ({
	width,
	height,
	refreshInterval = 120,
	useTestData = false,
	showDescription = true,
	isTTY = false,
	countdownInterval = 10, // in seconds
	minHeight = '50%',
}) => {
	const [tubeData, setTubeData] = useState<TubeLineStatus[]>([]);
	const [loading, setLoading] = useState(true);
	const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
	const [countdown, setCountdown] = useState(refreshInterval);
	const [error, setError] = useState<string | null>(null);

	// Function to fetch tube data
	const fetchTubeData = async () => {
		try {
			setLoading(true);
			setError(null);
			const statuses = await getTFLStatuses(useTestData);
			setTubeData(statuses);
			setLastUpdated(new Date());
			setCountdown(refreshInterval);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to fetch data');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchTubeData();

		const pollInterval = setInterval(() => {
			fetchTubeData();
		}, refreshInterval * 1000);

		return () => {
			clearInterval(pollInterval);
		};
	}, [refreshInterval]);

	useEffect(() => {
		if (loading) return;

		const timer = setInterval(() => {
			setCountdown(prev => {
				const next = prev - countdownInterval;
				// If we would hit 0 or go negative, reset to full interval
				if (next <= 0) {
					return refreshInterval;
				}
				return next;
			});
		}, countdownInterval * 1000);

		return () => clearInterval(timer);
	}, [loading, refreshInterval, countdownInterval]);

	return (
		<Box
			borderStyle="round"
			flexDirection="column"
			paddingX={1}
			paddingY={0}
			width={width}
			height={height}
			minHeight={minHeight}
		>
			<Box marginBottom={1} justifyContent="space-between">
				<Text bold color="cyan">
					{isTTY ? '' : '🚇 '}TFL Tube Status
				</Text>
				{lastUpdated && (
					<Box flexDirection="column" marginLeft={2}>
						<Text dimColor>
							Updated: {lastUpdated.toLocaleTimeString()} - {countdown}s
						</Text>
					</Box>
				)}
			</Box>
			{loading && tubeData.length === 0 ? (
				<>
					<Text color="cyan">Loading tube status...</Text>
					<Box marginTop={1}>
						<Text dimColor>⠋ Fetching data from TFL...</Text>
					</Box>
				</>
			) : error ? (
				<Text color="red">Error: {error}</Text>
			) : (
				<>
					{tubeData.map((line, index) => (
						<Box key={index} flexDirection="column">
							<Box>
								<Text color={getLineColor(line.lineName, isTTY)}>
									{getLineIndicator(line.lineName, isTTY)}{' '}
								</Text>
								<Text bold>{line.lineName}: </Text>
								<Text color={getStatusColor(line.statusSeverity)}>
									{line.statusSeverity}
								</Text>
							</Box>
							{line.affectedRoutes && line.affectedRoutes.length > 0 && (
								<Box flexDirection="column" marginLeft={2}>
									{line.affectedRoutes.map((route, routeIndex) => (
										<Box key={routeIndex}>
											<Text dimColor>{route}</Text>
										</Box>
									))}
								</Box>
							)}
							{line.description && showDescription && (
								<Box marginLeft={2}>
									<Text dimColor>{line.description}</Text>
								</Box>
							)}
						</Box>
					))}
					{tubeData.length > 0 && (
						<Box marginTop={1}>
							<Text color="green">Good service on all other lines</Text>
						</Box>
					)}
					{tubeData.length === 0 && (
						<Text color="green">All lines running normally ✓</Text>
					)}
				</>
			)}
		</Box>
	);
};
