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

		const countdownIntervalRef = setInterval(() => {
			setCountdown(prev => (prev > 0 ? prev - countdownInterval : 0));
		}, countdownInterval * 1000);

		return () => {
			clearInterval(countdownIntervalRef);
		};
	}, [loading]);

	return (
		<Box
			borderStyle="round"
			flexDirection="column"
			paddingX={1}
			paddingY={0}
			width={width}
			height={height}
		>
			{/* Header */}
			<Box marginBottom={1} justifyContent="space-between">
				<Text bold color="magenta">
					{isTTY ? '' : '🚉 '}
					{stationName} Departures
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
					<Box marginBottom={1}>
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
									Destination
								</Text>
							</Box>
						)}
						{displayColumns.status && (
							<Box width={12}>
								<Text bold dimColor>
									Status
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
										{departure.destination.length > 27
											? `${departure.destination.substring(0, 27)}...`
											: departure.destination}
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
			{!loading && departures.some(d => d.delayReason) && (
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
										{departure.scheduledTime} to {departure.destination}:{' '}
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
