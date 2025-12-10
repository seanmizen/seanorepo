import { Box, Card, CardActionArea, Typography } from '@mui/material';
import type { FC } from 'react';

const estimates = ['0', '1', '2', '3', '5', '8', '13', '21', '?'];

type EstimateCardsProps = {
  myVote: string | null;
  onEstimate: (estimate: string) => void;
  onRemoveVote: () => void;
  disabled?: boolean;
};

const EstimateCards: FC<EstimateCardsProps> = ({
  myVote,
  onEstimate,
  onRemoveVote,
  disabled = false,
}) => {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
        gap: 2,
      }}
    >
      {estimates.map((value) => {
        const isSelected = myVote === value;
        return (
          <Card
            key={value}
            elevation={3}
            sx={{
              bgcolor: isSelected ? 'primary.main' : undefined,
              color: isSelected ? 'primary.contrastText' : undefined,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <CardActionArea
              onClick={() => (isSelected ? onRemoveVote() : onEstimate(value))}
              disabled={disabled}
              aria-label={isSelected ? `Remove vote ${value}` : `Vote ${value}`}
              sx={{ p: 3 }}
            >
              <Typography variant="h4" align="center">
                {value}
              </Typography>
            </CardActionArea>
          </Card>
        );
      })}
    </Box>
  );
};

export { EstimateCards };
