import { Delete, Edit } from '@mui/icons-material';
import {
  Badge,
  Box,
  Button,
  Card,
  Fade,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { type FC, useState } from 'react';

type VoteStatus = {
  attendeeId: string;
  hasVoted: boolean;
  vote: string | null;
  name: string | null;
};

type Attendee = {
  id: string;
  name: string | null;
  connectionCount: number;
};

type VotingAreaProps = {
  myVote: string | null;
  voteStatus: VoteStatus[];
  revealed: boolean;
  attendeeId: string;
  attendees: Attendee[];
  currentEstimate: string | null;
  hasCurrentTicket: boolean;
  onRemoveVote: () => void;
  onReveal: () => void;
  onUnreveal: () => void;
  onUpdateName: (name: string) => void;
  onKickPlayer: (playerId: string, playerName: string) => void;
  onSetEstimate: (estimate: string | null) => void;
};

const VotingArea: FC<VotingAreaProps> = ({
  myVote,
  voteStatus,
  revealed,
  attendeeId,
  attendees,
  currentEstimate,
  hasCurrentTicket,
  onRemoveVote,
  onReveal,
  onUnreveal,
  onUpdateName,
  onKickPlayer,
  onSetEstimate,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const fibonacciNumbers = ['0', '1', '2', '3', '5', '8', '13', '21', '?'];
  const myStatus = voteStatus.find((s) => s.attendeeId === attendeeId);
  const myName = myStatus?.name || '';
  const myDisplayName = myName || attendeeId.slice(-4);

  const handleStartEditName = () => {
    setNameInput(myName);
    setIsEditingName(true);
  };

  const handleSubmitName = () => {
    if (nameInput.trim()) {
      onUpdateName(nameInput.trim());
    }
    setIsEditingName(false);
  };
  const otherPlayers = voteStatus.filter(
    (s) => !attendeeId || s.attendeeId !== attendeeId,
  );

  const totalPlayers = otherPlayers.length;

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3, overflow: 'visible' }}>
      <Box sx={{ display: 'flex', gap: 3, overflow: 'visible' }}>
        <Stack spacing={3} sx={{ flex: 1, overflow: 'visible' }}>
          <Box sx={{ overflow: 'visible' }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mb: 1, display: 'block', textAlign: 'center' }}
            >
              Other Players ({totalPlayers})
            </Typography>
            <Box
              sx={{
                display: 'flex',
                gap: 2,
                overflowX: 'auto',
                overflowY: 'clip',
                justifyContent: 'center',
                pb: 1,
                pt: 2,
              }}
            >
              {otherPlayers.map((status, index) => {
                const attendee = attendees.find(
                  (a) => a.id === status.attendeeId,
                );
                const isDisconnected = attendee?.connectionCount === 0;
                const connectionCount = attendee?.connectionCount || 0;
                const displayName = status.name || status.attendeeId.slice(-4);

                const tooltipTitle = isDisconnected
                  ? 'User disconnected'
                  : connectionCount > 1
                    ? `${status.name?.toUpperCase() || status.attendeeId.slice(-4)} HAS ${connectionCount} TABS OPEN!`
                    : '';

                return (
                  <Fade
                    key={status.attendeeId}
                    in={!!attendeeId}
                    timeout={300}
                    style={{ transitionDelay: `${index * 50}ms` }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        flexShrink: 0,
                        position: 'relative',
                      }}
                    >
                      <Box sx={{ position: 'relative' }}>
                        <IconButton
                          size="small"
                          onClick={() => {
                            if (window.confirm(`Kick ${displayName}?`)) {
                              onKickPlayer(status.attendeeId, displayName);
                            }
                          }}
                          sx={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            bgcolor: 'background.paper',
                            color: 'text.secondary',
                            width: 20,
                            height: 20,
                            zIndex: 1,
                            '&:hover': {
                              bgcolor: 'error.main',
                              color: 'white',
                            },
                          }}
                        >
                          <Delete sx={{ fontSize: 14 }} />
                        </IconButton>
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
                      </Box>
                      <Tooltip title={tooltipTitle} arrow>
                        <Stack
                          direction="row"
                          alignItems="center"
                          gap={0.5}
                          sx={{ mt: 0.5 }}
                        >
                          <Badge
                            badgeContent={
                              connectionCount > 1 ? connectionCount : 0
                            }
                            color="primary"
                            anchorOrigin={{
                              vertical: 'bottom',
                              horizontal: 'left',
                            }}
                          >
                            <Typography
                              variant="caption"
                              color={
                                isDisconnected
                                  ? 'text.disabled'
                                  : 'text.secondary'
                              }
                              noWrap
                              sx={{
                                maxWidth: 50,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {displayName}
                            </Typography>
                          </Badge>
                        </Stack>
                      </Tooltip>
                    </Box>
                  </Fade>
                );
              })}
            </Box>
          </Box>
          <Fade in={!!attendeeId} timeout={300}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="caption" display="block" gutterBottom>
                Your Vote
              </Typography>
              {myVote ? (
                <Card
                  elevation={3}
                  sx={{
                    width: 80,
                    height: 110,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    mx: 'auto',
                  }}
                  onClick={onRemoveVote}
                >
                  <Typography variant="h3">{myVote}</Typography>
                </Card>
              ) : (
                <Card
                  elevation={1}
                  sx={{
                    width: 80,
                    height: 110,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px dashed',
                    borderColor: 'divider',
                    mx: 'auto',
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    None
                  </Typography>
                </Card>
              )}
              <Stack
                direction="row"
                alignItems="center"
                gap={0.5}
                sx={{ mt: 1, justifyContent: 'center' }}
              >
                {isEditingName ? (
                  <TextField
                    variant="standard"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSubmitName();
                      if (e.key === 'Escape') setIsEditingName(false);
                    }}
                    onBlur={handleSubmitName}
                    autoFocus
                    placeholder="Your name"
                    sx={{ width: 100 }}
                  />
                ) : (
                  <>
                    <Typography
                      variant="body1"
                      color={myName ? 'text.primary' : 'text.secondary'}
                    >
                      {myDisplayName}
                    </Typography>
                    <IconButton size="small" onClick={handleStartEditName}>
                      <Edit fontSize="small" />
                    </IconButton>
                  </>
                )}
              </Stack>
            </Box>
          </Fade>
        </Stack>
        <Stack spacing={2} sx={{ justifyContent: 'center' }}>
          <Button
            variant={revealed ? 'outlined' : 'contained'}
            onClick={revealed ? onUnreveal : onReveal}
            disabled={!hasCurrentTicket}
            sx={{ minWidth: 160 }}
          >
            {revealed ? 'Hide Votes' : 'Reveal Votes'}
          </Button>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography
              variant="body2"
              color={hasCurrentTicket ? 'success.main' : 'textDisabled'}
              gutterBottom
              display="block"
            >
              Final Estimate
            </Typography>
            <TextField
              select
              size="small"
              value={currentEstimate || ''}
              onChange={(e) => {
                onSetEstimate(e.target.value || null);
              }}
              disabled={!hasCurrentTicket}
              slotProps={{ select: { native: true } }}
              sx={{ width: 80 }}
            >
              <option value="">-</option>
              {fibonacciNumbers.map((num) => (
                <option key={num} value={num}>
                  {num}
                </option>
              ))}
            </TextField>
          </Paper>
        </Stack>
      </Box>
    </Paper>
  );
};

export { VotingArea };
