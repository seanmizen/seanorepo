import React, {FC, useEffect, useState} from 'react';
import {Box, Text} from 'ink';

const CHRISTMAS_QUOTES = [
	'Merry Christmas Ya Filthy Animal',
	"'Tis the season to be jolly!",
	'Ho Ho Ho! Merry Christmas!',
	'All I want for Christmas is you',
	"Baby it's cold outside",
	'Jingle all the way!',
	'Let it snow, let it snow!',
	'Deck the halls with boughs of holly',
	'Have yourself a merry little Christmas',
	'Walking in a winter wonderland',
	"It's the most wonderful time of the year",
	'Peace on Earth, goodwill to all',
	'Believe in the magic of Christmas',
	'Santa Claus is coming to town!',
	'Feliz Navidad!',
];

interface XmasQuotesProps {
	rotateInterval?: number; // in seconds
	isTTY?: boolean;
}

export const XmasQuotes: FC<XmasQuotesProps> = ({
	rotateInterval = 60,
	isTTY = false,
}) => {
	const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setCurrentQuoteIndex(prev => (prev + 1) % CHRISTMAS_QUOTES.length);
		}, rotateInterval * 1000);

		return () => clearInterval(interval);
	}, [rotateInterval]);

	return (
		<Box flexDirection="column" paddingX={1} paddingY={1}>
			<Text color="red" bold>
				{isTTY ? '' : '🎄 '}
				{CHRISTMAS_QUOTES[currentQuoteIndex]}
				{isTTY ? '' : ' 🎅'}
			</Text>
		</Box>
	);
};
