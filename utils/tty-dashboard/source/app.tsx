import { Box, Text, useApp, useInput, useStdout } from 'ink';
import React, { type FC, useEffect } from 'react';
import { SpoonsFinder } from './spoons-finder.js';
import { StationDepartureBoard } from './station-departure-board.js';
import { Tetris } from './tetris.js';
import { TFLStatus } from './tfl-status.js';
import { XmasQuotes } from './xmas-quotes.js';
import { YouTubeAsciiPlayer } from './youtube-ascii-player.js';

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
const SECRET_MODES =
  process.env['SECRET_MODES']?.split(',').map((s) => s.trim()) || [];

const App: FC<Props> = () => {
  const { exit } = useApp();
  const { stdout } = useStdout();

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
        <Box flexDirection="column" width="50%" flexGrow={1}>
          <TFLStatus
            width="100%"
            useTestData={USE_TEST_DATA}
            showDescription={SHOW_TFL_DESCRIPTION}
            isTTY={IS_TTY}
            refreshInterval={REFRESH_INTERVAL}
            countdownInterval={SCREEN_REFRESH_INTERVAL}
            spooky={SECRET_MODES.includes('spooky')}
          />
          <Box flexDirection="row" alignItems="flex-end" flexGrow={1}>
            {SECRET_MODES.includes('tetris') && <Tetris />}
            {SECRET_MODES.includes('youtube') && <YouTubeAsciiPlayer />}
            {SECRET_MODES.includes('xmas') && <XmasQuotes isTTY={IS_TTY} />}
          </Box>
        </Box>
        <Box width="50%" flexGrow={1} flexDirection="column">
          <StationDepartureBoard
            stationName="Putney"
            columns={{ operator: false }}
            width="100%"
            useTestData={USE_TEST_DATA}
            maxDepartures={MAX_RAIL_DEPARTURES}
            isTTY={IS_TTY}
            refreshInterval={REFRESH_INTERVAL}
            countdownInterval={SCREEN_REFRESH_INTERVAL}
            spooky={SECRET_MODES.includes('spooky')}
          />
          {SECRET_MODES.includes('spoons') && (
            <SpoonsFinder
              width="100%"
              height="50%"
              location={process.env['SPOONS_LOCATION'] || 'putney'}
              lat={
                process.env['SPOONS_LAT']
                  ? Number(process.env['SPOONS_LAT'])
                  : undefined
              }
              lng={
                process.env['SPOONS_LNG']
                  ? Number(process.env['SPOONS_LNG'])
                  : undefined
              }
              useTestData={true} // TODO
              isTTY={IS_TTY}
            />
          )}
        </Box>
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

export { App };
