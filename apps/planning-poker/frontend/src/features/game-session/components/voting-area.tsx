import { Box, Button, Card, Paper, Typography } from '@mui/material';
import type { FC } from 'react';

type VoteStatus = {
  attendeeId: string;
  hasVoted: boolean;
  vote: string | null;
};

type VotingAreaProps = {
  myVote: string | null;
  voteStatus: VoteStatus[];
  revealed: boolean;
  attendeeId: string;
  onRemoveVote: () => void;
  onReveal: () => void;
  onUnreveal: () => void;
};

const VotingArea: FC<VotingAreaProps> = ({
  myVote,
  voteStatus,
  revealed,
  attendeeId,
  onRemoveVote,
  onReveal,
  onUnreveal,
}) => {
  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <Box
        sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Box>
          <Typography variant="caption" display="block" gutterBottom>
            Your Vote
          </Typography>
          {myVote ? (
            <Card
              elevation={3}
              sx={{
                width: 60,
                height: 80,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
              onClick={onRemoveVote}
            >
              <Typography variant="h4">{myVote}</Typography>
            </Card>
          ) : (
            <Card
              elevation={1}
              sx={{
                width: 60,
                height: 80,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px dashed',
                borderColor: 'divider',
              }}
            >
              <Typography variant="caption" color="text.secondary">
                None
              </Typography>
            </Card>
          )}
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" display="block" gutterBottom>
            Other Votes
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {voteStatus
              .filter((s) => !attendeeId || s.attendeeId !== attendeeId)
              .map((status) => (
                <Box key={status.attendeeId} sx={{ textAlign: 'center' }}>
                  <Card
                    elevation={3}
                    sx={{
                      width: 50,
                      height: 70,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: status.hasVoted
                        ? revealed
                          ? 'success.main'
                          : 'info.main'
                        : 'grey.300',
                      color: status.hasVoted ? 'white' : 'text.disabled',
                    }}
                  >
                    {revealed && status.vote ? (
                      <Typography variant="h5">{status.vote}</Typography>
                    ) : status.hasVoted ? (
                      <Typography variant="h6">?</Typography>
                    ) : (
                      <Typography variant="caption">-</Typography>
                    )}
                  </Card>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontSize: '0.7rem' }}
                  >
                    {status.attendeeId.slice(-4)}
                  </Typography>
                </Box>
              ))}
          </Box>
        </Box>

        {!revealed ? (
          <Button variant="contained" onClick={onReveal}>
            Reveal
          </Button>
        ) : (
          <Button variant="outlined" onClick={onUnreveal}>
            Hide
          </Button>
        )}
      </Box>
    </Paper>
  );
};

export { VotingArea };
