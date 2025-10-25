import React, {FC, useEffect, useState} from 'react';
import {Text, Box} from 'ink';
import {
	TrainDeparture,
	getNationalRailDepartures,
} from './national-rail-scraper.js';

export type ColumnConfig = {
	time?: boolean;
	destination?: boolean;
	status?: boolean;
	platform?: boolean;
	duration?: boolean;
	operator?: boolean;
};

const DEFAULT_COLUMNS: ColumnConfig = {
	time: true,
	destination: true,
	status: true,
	platform: true,
	duration: true,
	operator: true,
};

type Props = {
	stationName: string;
	useTestData?: boolean;
	refreshInterval?: number; // poll interval, in seconds
	countdownInterval?: number; // screen refresh interval, in seconds
	maxDepartures?: number; // maximum number of departures to display
	columns?: ColumnConfig; // which columns to display
	width?: string | number;
	height?: string | number;
	isTTY?: boolean;
	minHeight?: string | number;
	spooky?: boolean;
};

const spookifyDestination = (destination: string): string => {
	const spookMap: Record<string, string> = {
		'London Waterloo': 'London Waterghoul',
		Waterloo: 'Waterghoul',
		Weybridge: 'Wailbridge',
		Kingston: 'Killston',
		'Windsor & Eton Riverside': 'Windscream & Eaten Riverside',
		'Clapham Junction': 'Clapham Conjure-tion',
		Ascot: 'Ascot (but scary)',
		Putney: 'Putrefied',
		Richmond: 'Wretchmond',
		Wimbledon: 'Whimbledon',
		Reading: 'Bleeding',
		Guildford: 'Guiltyford',
		Basingstoke: 'Hauntingstoke',
		Southampton: 'Screamhampton',
		Woking: 'Wailing',
		Surbiton: 'Scarybiton',
		Epsom: 'Creepsom',
	};
	return spookMap[destination] || destination;
};

const spookifyStationName = (stationName: string): string => {
	const spookMap: Record<string, string> = {
		Putney: 'Putrid-ney',
	};
	return spookMap[stationName] || stationName;
};

export const StationDepartureBoard: FC<Props> = ({
	stationName,
	refreshInterval = 120,
	maxDepartures = 4,
	columns = DEFAULT_COLUMNS,
	width,
	height,
	useTestData = false,
	isTTY = false,
	countdownInterval = 10, // in seconds
	minHeight = '50%',
	spooky = false,
}) => {
	// Merge provided columns with defaults
	const displayColumns = {...DEFAULT_COLUMNS, ...columns};
	const [departures, setDepartures] = useState<TrainDeparture[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [lastUpdated, setLastUpdate] = useState<Date | null>(null);
	const [countdown, setCountdown] = useState(refreshInterval);

	const fetchDepartures = async () => {
		try {
			setLoading(true);
			setError(null);
			const data = await getNationalRailDepartures(stationName, useTestData);
			setDepartures(data);
			setLastUpdate(new Date());
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unknown error');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchDepartures();
		const interval = setInterval(fetchDepartures, refreshInterval * 1000);
		return () => clearInterval(interval);
	}, [stationName, refreshInterval]);

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
			{/* Header */}
			<Box marginBottom={1} justifyContent="space-between">
				<Text bold color="magenta">
					{isTTY ? '' : '🚉 '}
					{spooky ? spookifyStationName(stationName) : stationName} Departures
				</Text>
				{lastUpdated && (
					<Text dimColor color="gray">
						Updated: {lastUpdated.toLocaleTimeString()} - {countdown}s
					</Text>
				)}
			</Box>

			{/* Loading state */}
			{loading && departures.length === 0 && (
				<Box flexDirection="column">
					<Text color="yellow">Loading departures...</Text>
				</Box>
			)}

			{/* Error state */}
			{error && (
				<Box flexDirection="column">
					<Text color="red">Error: {error}</Text>
				</Box>
			)}

			{/* Departure list */}
			{departures.length > 0 && (
				<Box flexDirection="column">
					{/* Column headers */}
					<Box>
						{displayColumns.time && (
							<Box width={7}>
								<Text bold dimColor>
									Time
								</Text>
							</Box>
						)}
						{displayColumns.destination && (
							<Box width={30}>
								<Text bold dimColor>
									{spooky ? 'Place of Death' : 'Destination'}
								</Text>
							</Box>
						)}
						{displayColumns.status && (
							<Box width={12}>
								<Text bold dimColor>
									{spooky ? 'Fate' : 'Status'}
								</Text>
							</Box>
						)}
						{displayColumns.platform && (
							<Box width={6}>
								<Text bold dimColor>
									Plat.
								</Text>
							</Box>
						)}
						{displayColumns.duration && (
							<Box width={8}>
								<Text bold dimColor>
									Dur.
								</Text>
							</Box>
						)}
						{displayColumns.operator && (
							<Box width={20}>
								<Text bold dimColor>
									Operator
								</Text>
							</Box>
						)}
					</Box>

					{/* Departure rows */}
					{departures.slice(0, maxDepartures).map((departure, index) => (
						<Box key={index} marginBottom={0}>
							{/* Time */}
							{displayColumns.time && (
								<Box width={7}>
									<Text bold color={departure.isDelayed ? 'red' : 'green'}>
										{departure.scheduledTime}
									</Text>
								</Box>
							)}

							{/* Destination */}
							{displayColumns.destination && (
								<Box width={30}>
									<Text>
										{(() => {
											const displayName = spooky
												? spookifyDestination(departure.destination)
												: departure.destination;
											return displayName.length > 27
												? `${displayName.substring(0, 27)}...`
												: displayName;
										})()}
									</Text>
								</Box>
							)}

							{/* Status */}
							{displayColumns.status && (
								<Box width={12}>
									<Text color={departure.isDelayed ? 'red' : 'green'}>
										{departure.status === 'On time'
											? 'On time'
											: `→ ${departure.expectedTime}`}
									</Text>
								</Box>
							)}

							{/* Platform */}
							{displayColumns.platform && (
								<Box width={6}>
									<Text color="cyan">{departure.platform}</Text>
								</Box>
							)}

							{/* Duration */}
							{displayColumns.duration && (
								<Box width={8}>
									<Text dimColor>{departure.duration}</Text>
								</Box>
							)}

							{/* Operator */}
							{displayColumns.operator && (
								<Box width={20}>
									<Text dimColor>
										{departure.operator.length > 18
											? `${departure.operator.substring(0, 18)}...`
											: departure.operator}
									</Text>
								</Box>
							)}
						</Box>
					))}
				</Box>
			)}

			{/* Delayed trains section */}
			{departures.some(d => d.delayReason) && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold color="yellow">
						⚠️ Delay Information:
					</Text>
					{departures
						.filter(d => d.delayReason)
						.slice(0, 3)
						.map((departure, index) => (
							<Box key={index} marginTop={0} flexDirection="column">
								<Box>
									<Text color="yellow">
										{departure.scheduledTime} to{' '}
										{spooky
											? spookifyDestination(departure.destination)
											: departure.destination}
										:{' '}
									</Text>
								</Box>
								<Box marginLeft={2}>
									<Text dimColor>
										{departure.delayReason && departure.delayReason.length > 60
											? `${departure.delayReason.substring(0, 60)}...`
											: departure.delayReason}
									</Text>
								</Box>
							</Box>
						))}
				</Box>
			)}

			{/* Empty state */}
			{!loading && !error && departures.length === 0 && (
				<Box flexDirection="column">
					<Text dimColor>No departures found</Text>
				</Box>
			)}
		</Box>
	);
};
