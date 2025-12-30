import { Box, Card, CardActionArea, Stack, Typography } from '@mui/material';
import type { FC } from 'react';

// Row-based layout: common values prominent, rare values smaller
const commonEstimates = ['1', '2', '3', '5', '8'];
const rareEstimates = ['0', '13', '21', '?'];

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
  const renderCard = (value: string, isCommon: boolean) => {
    const isSelected = myVote === value;
    const height = isCommon ? 100 : 70;
    const typographyVariant = isCommon ? 'h3' : 'h5';

    return (
      <Card
        key={value}
        elevation={3}
        sx={{
          height,
          flex: 1,
          bgcolor: isSelected ? 'primary.main' : undefined,
          color: isSelected ? 'primary.contrastText' : undefined,
          opacity: disabled ? 0.5 : 1,
          transform: isSelected ? 'scale(1.02)' : 'scale(1)',
          '&:hover': {
            transform: disabled ? 'scale(1)' : 'scale(1.05)',
            boxShadow: disabled ? undefined : 6,
          },
        }}
      >
        <CardActionArea
          onClick={() => (isSelected ? onRemoveVote() : onEstimate(value))}
          disabled={disabled}
          aria-label={isSelected ? `Remove vote ${value}` : `Vote ${value}`}
          sx={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography
            variant={typographyVariant}
            align="center"
            sx={{
              fontWeight: isSelected ? 700 : undefined,
            }}
          >
            {value}
          </Typography>
        </CardActionArea>
      </Card>
    );
  };

  return (
    <Stack spacing={2} sx={{ py: 1 }}>
      {/* Top row: Common values (larger) */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        {commonEstimates.map((value) => renderCard(value, true))}
      </Box>

      {/* Bottom row: Rare values (smaller) */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        {rareEstimates.map((value) => renderCard(value, false))}
      </Box>
    </Stack>
  );
};

export { EstimateCards };
