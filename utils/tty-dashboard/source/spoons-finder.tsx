import { Box, Text } from 'ink';
import { type FC, useEffect, useState } from 'react';
import { getSpoonsData, type SpoonsPub } from './spoons-scraper.js';

// TODO: Consider using a geocoding library to automatically get lat/lng from location name
// Options: node-geocoder, opencage-api-client, or Google Geocoding API
// For now, lat/lng are optional and can be provided via environment variables

type Props = {
  width?: string | number;
  height?: string | number;
  location: string;
  lat?: number;
  lng?: number;
  useTestData?: boolean;
  isTTY?: boolean;
};

export const SpoonsFinder: FC<Props> = ({
  width,
  height,
  location,
  lat,
  lng,
  useTestData = false,
  isTTY = false,
}) => {
  const [pubsData, setPubsData] = useState<SpoonsPub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Function to fetch pubs data - runs once on mount
  const fetchPubsData = async () => {
    try {
      setLoading(true);
      setError(null);
      const pubs = await getSpoonsData(location, lat, lng, useTestData);
      setPubsData(pubs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  // Fetch data once on component mount
  useEffect(() => {
    fetchPubsData();
  }, []);

  return (
    <Box
      borderStyle="round"
      flexDirection="column"
      paddingX={1}
      paddingY={0}
      width={width}
      height={height}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {isTTY ? '' : '🍺 '}Wetherspoons Near me
        </Text>
      </Box>
      {loading ? (
        <>
          <Text color="cyan">Finding pubs...</Text>
          <Box marginTop={1}>
            <Text dimColor>⠋ Searching Wetherspoons...</Text>
          </Box>
        </>
      ) : error ? (
        <Text color="red">Error: {error}</Text>
      ) : (
        // biome-ignore lint/complexity/noUselessFragments: biome is wrong
        <>
          {pubsData.length === 0 ? (
            <Text color="yellow">No Wetherspoons found in this area</Text>
          ) : (
            <>
              {pubsData.map((pub) => (
                <Box key={pub.name} flexDirection="column" marginBottom={1}>
                  <Box>
                    <Text bold color="green">
                      {pub.name}
                    </Text>
                    <Text dimColor> - {pub.distance}</Text>
                  </Box>
                  <Box marginLeft={2}>
                    <Text dimColor>{pub.address}</Text>
                  </Box>
                  <Box marginLeft={2}>
                    <Text color={pub.openStatus === 'Open' ? 'green' : 'red'}>
                      {pub.openStatus}
                    </Text>
                    {pub.closingTime && (
                      <>
                        <Text> • </Text>
                        <Text dimColor>{pub.closingTime}</Text>
                      </>
                    )}
                  </Box>
                  {pub.facilities.length > 0 && (
                    <Box marginLeft={2}>
                      <Text dimColor>
                        Facilities: {pub.facilities.slice(0, 3).join(', ')}
                        {pub.facilities.length > 3 && '...'}
                      </Text>
                    </Box>
                  )}
                </Box>
              ))}
              <Box marginTop={1}>
                <Text dimColor>
                  Found {pubsData.length} pub{pubsData.length !== 1 ? 's' : ''}
                </Text>
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
};
