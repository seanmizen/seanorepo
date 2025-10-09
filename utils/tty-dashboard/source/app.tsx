import React, {FC} from 'react';
import {Text, useInput, useApp, Box, useStdout} from 'ink';
import {TFLStatus} from './tfl-status.js';
import {StationDepartureBoard} from './station-departure-board.js';

type Props = {
	name: string | undefined;
};

const SHOW_SCREEN_DIMENSIONS = process.env['SHOW_SCREEN_DIMENSIONS'] === 'true';
const USE_TEST_DATA = process.env['USE_TEST_DATA'] === 'true';
const SHOW_TFL_DESCRIPTION = process.env['SHOW_TFL_DESCRIPTION'] === 'true';

const App: FC<Props> = () => {
	const {exit} = useApp();
	const {stdout} = useStdout();

	useInput((input, key) => {
		if (input === 'q' || key.escape) {
			exit();
		}
	});

	return (
		<Box
			borderStyle="round"
			display="flex"
			flexDirection="column"
			paddingX={1}
			paddingBottom={1}
			minHeight={stdout?.rows}
		>
			<Box flexDirection="row" flexGrow={1}>
				<TFLStatus
					width="50%"
					useTestData={USE_TEST_DATA}
					showDescription={SHOW_TFL_DESCRIPTION}
				/>
				<StationDepartureBoard
					stationName="Putney"
					columns={{operator: false}}
					width="50%"
					useTestData={USE_TEST_DATA}
				/>
			</Box>
			<Box justifyContent="space-between" width="100%">
				<Text dimColor>Press 'q' or ESC to quit</Text>
				{SHOW_SCREEN_DIMENSIONS && stdout && (
					<Text dimColor>
						Screen: {stdout.columns}x{stdout.rows}
					</Text>
				)}
			</Box>
		</Box>
	);
};

export {App};
