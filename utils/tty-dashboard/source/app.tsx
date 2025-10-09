import React, {FC, useEffect} from 'react';
import {Text, useInput, useApp, Box, useStdout} from 'ink';
import {TFLStatus} from './tfl-status.js';
import {StationDepartureBoard} from './station-departure-board.js';

type Props = {
	name: string | undefined;
};

const SHOW_DEBUG_INFO = process.env['SHOW_DEBUG_INFO'] === 'true';
const USE_TEST_DATA = process.env['USE_TEST_DATA'] === 'true';
const SHOW_TFL_DESCRIPTION = process.env['SHOW_TFL_DESCRIPTION'] === 'true';
const MAX_RAIL_DEPARTURES = Number(process.env['MAX_RAIL_DEPARTURES']) || 4;
const IS_TTY =
	process.env['TERM'] === 'linux' || process.env['TERM']?.startsWith('vt');
const REFRESH_INTERVAL = Number(process.env['REFRESH_INTERVAL']) || 120; // in seconds
const SCREEN_REFRESH_INTERVAL =
	Number(process.env['SCREEN_REFRESH_INTERVAL']) || 10; // in seconds

const App: FC<Props> = () => {
	const {exit} = useApp();
	const {stdout} = useStdout();

	useInput((input, key) => {
		if (input === 'q' || key.escape) {
			exit();
		}
	});

	const [date, setDate] = React.useState(new Date());
	useEffect(() => {
		const interval = setInterval(() => {
			setDate(new Date());
		}, SCREEN_REFRESH_INTERVAL * 1000);
		return () => clearInterval(interval);
	}, []);

	return (
		<Box
			borderStyle="round"
			display="flex"
			flexDirection="column"
			paddingX={1}
			paddingBottom={1}
			minHeight={stdout?.rows}
		>
			<Box>
				<Box>
					<Text>Time now: {date.toLocaleTimeString()}</Text>
				</Box>
			</Box>
			<Box flexDirection="row" flexGrow={1}>
				<TFLStatus
					width="50%"
					useTestData={USE_TEST_DATA}
					showDescription={SHOW_TFL_DESCRIPTION}
					isTTY={IS_TTY}
					refreshInterval={REFRESH_INTERVAL}
					countdownInterval={SCREEN_REFRESH_INTERVAL}
				/>
				<StationDepartureBoard
					stationName="Putney"
					columns={{operator: false}}
					width="50%"
					useTestData={USE_TEST_DATA}
					maxDepartures={MAX_RAIL_DEPARTURES}
					isTTY={IS_TTY}
					refreshInterval={REFRESH_INTERVAL}
					countdownInterval={SCREEN_REFRESH_INTERVAL}
				/>
			</Box>
			{SHOW_DEBUG_INFO && (
				<Box justifyContent="space-between" width="100%">
					<Text dimColor>Press 'q' or ESC to quit</Text>
					{stdout && (
						<Text dimColor>
							Screen: {stdout.columns}x{stdout.rows}
						</Text>
					)}
				</Box>
			)}
		</Box>
	);
};

export {App};
