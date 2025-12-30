import { Delete, Edit } from '@mui/icons-material';
import {
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Fade,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Linkify from 'linkify-react';
import { type FC, useState } from 'react';
import { NameModal } from './name-modal';

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
  currentTicketTitle?: string;
  currentTicketAverage?: string | null;
  onRemoveVote: () => void;
  onReveal: () => void;
  onUnreveal: () => void;
  onUpdateName: (name: string) => void;
  onKickPlayer: (playerId: string, playerName: string) => void;
  onSetEstimate: (estimate: string | null) => void;
  onStartAddingTicket: () => void;
};

const VotingArea: FC<VotingAreaProps> = ({
  myVote,
  voteStatus,
  revealed,
  attendeeId,
  attendees,
  currentEstimate,
  hasCurrentTicket,
  currentTicketTitle,
  currentTicketAverage,
  onRemoveVote,
  onReveal,
  onUnreveal,
  onUpdateName,
  onKickPlayer,
  onSetEstimate,
  onStartAddingTicket,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [hasSkippedNameModal, setHasSkippedNameModal] = useState(false);
  const lastUsedName = localStorage.getItem('last-used-name') || '';

  const fibonacciNumbers = ['0', '1', '2', '3', '5', '8', '13', '21', '?'];
  const myStatus = voteStatus.find((s) => s.attendeeId === attendeeId);
  const myName = myStatus?.name || '';
  const myDisplayName = myName || attendeeId.slice(-4);

  const shouldShowNameModal =
    !!attendeeId && !myName && !isEditingName && !hasSkippedNameModal;

  const handleNameModalSubmit = (name: string) => {
    onUpdateName(name);
  };

  const handleNameModalSkip = () => {
    setHasSkippedNameModal(true);
  };

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
    <Paper
      elevation={2}
      sx={{
        p: 2.5,
        mb: 3,
        overflow: 'visible',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Ticket Info Header */}
      <Fade in={!!attendeeId} timeout={400}>
        <Box sx={{ mb: 2 }}>
          <Stack
            direction="row"
            gap={2}
            sx={{ minWidth: 0, overflow: 'hidden', mb: 0.5 }}
          >
            <Typography variant="h6" sx={{ flexShrink: 0, fontWeight: 600 }}>
              We are refining:
            </Typography>
            <Typography
              variant="h6"
              sx={{
                color: 'currentColor',
                minWidth: 0,
                display: 'flex',
                '& > *': {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }}
            >
              {currentTicketTitle ? (
                <Linkify
                  options={{
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    render: ({ attributes, content }) => (
                      <a {...attributes} style={{ direction: 'rtl' }}>
                        {content.replace(/\/$/g, '')}
                      </a>
                    ),
                  }}
                >
                  {currentTicketTitle}
                </Linkify>
              ) : (
                <Stack direction={'row'} gap={1}>
                  Nothing yet.
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      onStartAddingTicket();
                      const ticketListElement =
                        document.getElementById('ticket-list');
                      if (ticketListElement) {
                        ticketListElement.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        });
                      }
                    }}
                    sx={{ textTransform: 'none' }}
                  >
                    Add a ticket!
                  </Button>
                </Stack>
              )}
            </Typography>
          </Stack>
          <Stack direction="row" gap={2} sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="info.main">
              {hasCurrentTicket
                ? currentTicketAverage
                  ? `Voting average: ${currentTicketAverage}`
                  : 'Votes pending...'
                : '\xa0'}
            </Typography>
            {currentEstimate && (
              <Typography variant="body2" color="success.main">
                Final Estimate: {currentEstimate}
              </Typography>
            )}
          </Stack>
          <Divider sx={{ mt: 1.5 }} />
        </Box>
      </Fade>

      <Box sx={{ display: 'flex', gap: 3, overflow: 'visible' }}>
        <Stack spacing={3} sx={{ flex: 1, overflow: 'visible' }}>
          <Box sx={{ overflow: 'visible' }}>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mb: 2,
                display: 'block',
                textAlign: 'center',
                fontWeight: 600,
              }}
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
                    ? `${
                        status.name?.toUpperCase() ||
                        status.attendeeId.slice(-4)
                      } HAS ${connectionCount} TABS OPEN!`
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
                            width: 55,
                            height: 75,
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
                            <Typography variant="h4">{status.vote}</Typography>
                          ) : status.hasVoted ? (
                            <Typography variant="h5">?</Typography>
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
            <Box sx={{ textAlign: 'center', py: 1 }}>
              <Typography
                variant="subtitle2"
                display="block"
                gutterBottom
                sx={{ fontWeight: 600 }}
              >
                Your Vote
              </Typography>
              {myVote ? (
                <Card
                  elevation={3}
                  sx={{
                    width: 70,
                    height: 100,
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
                    width: 70,
                    height: 100,
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
                      variant="h6"
                      color={myName ? 'text.primary' : 'text.secondary'}
                      sx={{ fontWeight: 500 }}
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
        <Stack
          spacing={2}
          sx={{ justifyContent: 'flex-end', alignItems: 'flex-end' }}
        >
          <Button
            variant={revealed ? 'outlined' : 'contained'}
            onClick={revealed ? onUnreveal : onReveal}
            disabled={!hasCurrentTicket}
            sx={{ minWidth: 160 }}
          >
            {revealed ? 'Hide Votes' : 'Reveal Votes'}
          </Button>
          <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
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
      <NameModal
        open={shouldShowNameModal}
        onSubmit={handleNameModalSubmit}
        onSkip={handleNameModalSkip}
        lastUsedName={lastUsedName}
      />
    </Paper>
  );
};

export { VotingArea };
