import { Box, Card, CardActionArea, Typography } from '@mui/material';
import type { FC } from 'react';

const estimates = ['0', '1', '2', '3', '5', '8', '13', '21', '?'];

type EstimateCardsProps = {
  onEstimate: (estimate: string) => void;
};

const EstimateCards: FC<EstimateCardsProps> = ({ onEstimate }) => {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
        gap: 2,
      }}
    >
      {estimates.map((value) => (
        <Card key={value} elevation={3}>
          <CardActionArea onClick={() => onEstimate(value)} sx={{ p: 3 }}>
            <Typography variant="h4" align="center">
              {value}
            </Typography>
          </CardActionArea>
        </Card>
      ))}
    </Box>
  );
};

export { EstimateCards };
