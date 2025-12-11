import {
  CopyAllOutlined,
  ExpandMore,
  HomeFilled,
  Link as LinkIcon,
  Refresh,
} from '@mui/icons-material';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Fade,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import Linkify from 'linkify-react';
import type { FC } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { ThemeToggle } from '@/components';
import { api, env } from '@/config';
import { showSnackbar } from '@/lib';
import { EstimateCards, TicketList, VotingArea } from './components';
import { useGameSession } from './hooks';

const SHOW_ATTENDEES = false;

const GameSession: FC = () => {
  const [searchParams] = useSearchParams();
  const shortId = searchParams.get('session-code');

  const {
    tickets,
    currentTicketIndex,
    currentTicket,
    attendees,
    attendeeId,
    voteStatus,
    myVote,
    revealed,
    disclaimerDismissed,
    ticketVotesMap,
    handleAddTicket,
    handleDeleteTicket,
    handleVote,
    handleRemoveVote,
    handleReveal,
    handleUnreveal,
    handleSelectTicket,
    handleRefresh,
    handleDismissDisclaimer,
    handleUpdateTicketTitle,
  } = useGameSession(shortId);

  const calculateAverage = (votes: { vote: string | null }[]) => {
    const numericVotes = votes
      .map((v) => v.vote)
      .filter((v) => v && v !== '?')
      .map((v) => Number.parseFloat(v || '0'))
      .filter((v) => !Number.isNaN(v));

    if (numericVotes.length === 0) return null;
    const sum = numericVotes.reduce((a, b) => a + b, 0);
    return (sum / numericVotes.length).toFixed(1);
  };

  const currentTicketVotes = currentTicket
    ? ticketVotesMap.get(currentTicket.id)
    : null;
  const currentTicketAverage = currentTicketVotes?.revealed
    ? calculateAverage(currentTicketVotes.votes)
    : null;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
        }}
      >
        <Typography variant="h4">
          Planning Poker: session <code>{shortId}</code>
          <Tooltip title="Copy session code">
            <IconButton
              onClick={() => {
                navigator.clipboard.writeText(shortId || '');
                showSnackbar('Session code copied to clipboard', 'success');
              }}
            >
              <CopyAllOutlined />
            </IconButton>
          </Tooltip>
          <Tooltip title="Copy session URL">
            <IconButton
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                showSnackbar('Session URL copied to clipboard', 'success');
              }}
            >
              <LinkIcon />
            </IconButton>
          </Tooltip>
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {env.debugShowAttendeeId && attendeeId && (
            <Typography variant="body2" color="text.secondary">
              Your ID: <code>{attendeeId.slice(-8)}</code>
            </Typography>
          )}
          {env.debugShowRefreshButton && (
            <Tooltip title="Refresh game state">
              <IconButton onClick={handleRefresh} size="small" color="primary">
                <Refresh />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Country Roads!">
            <IconButton component={RouterLink} to="/" color="inherit">
              <HomeFilled />
            </IconButton>
          </Tooltip>
          <ThemeToggle />
        </Box>
      </Box>
      <Stack
        direction={{
          xs: 'column-reverse',
          md: 'row',
        }}
        gap={{ xs: 6, md: 3 }}
        divider={<Divider />}
      >
        <Stack spacing={{ xs: 1, md: 3 }} sx={{ flex: 1, minWidth: 0 }}>
          {SHOW_ATTENDEES && (
            <Accordion defaultExpanded>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="h6">
                  Attendees ({attendees.length})
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                {attendees.map((attendee, index) => {
                  const status = voteStatus.find(
                    (v) => v.attendeeId === attendee.id,
                  );
                  const isMe = attendee.id === attendeeId;
                  const isDisconnected = attendee.connectionCount === 0;
                  const displayName = attendee.name || attendee.id.slice(-4);

                  const tooltipTitle = isDisconnected
                    ? 'User disconnected'
                    : attendee.connectionCount > 1
                      ? `${attendee.name?.toUpperCase() || attendee.id.slice(-4)} HAS ${attendee.connectionCount} TABS OPEN!`
                      : '';

                  return (
                    <Fade
                      key={attendee.id}
                      in={!!attendeeId}
                      timeout={300}
                      style={{ transitionDelay: `${index * 30}ms` }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          gap: 1,
                          mb: 1,
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Tooltip title={tooltipTitle} arrow>
                          <Badge
                            anchorOrigin={{
                              vertical: 'top',
                              horizontal: 'left',
                            }}
                            badgeContent={
                              attendee.connectionCount > 1
                                ? attendee.connectionCount
                                : 0
                            }
                            color="primary"
                          >
                            <Stack
                              direction={'row'}
                              gap={2}
                              alignItems={'center'}
                            >
                              <Avatar
                                sx={{
                                  bgcolor: isDisconnected
                                    ? 'error.main'
                                    : undefined,
                                }}
                              />
                              <Typography
                                variant="body2"
                                fontWeight={isMe ? 'bold' : 'normal'}
                                color={
                                  isDisconnected ? 'text.disabled' : undefined
                                }
                              >
                                {displayName}
                                {isMe ? ' (you)' : ''}:
                              </Typography>
                            </Stack>
                          </Badge>
                        </Tooltip>
                        <Typography
                          variant="body2"
                          color={
                            status?.hasVoted ? 'success.main' : 'text.secondary'
                          }
                        >
                          {status?.hasVoted ? 'Voted' : 'Not voted'}
                        </Typography>
                      </Box>
                    </Fade>
                  );
                })}
              </AccordionDetails>
            </Accordion>
          )}
          <TicketList
            tickets={tickets}
            currentIndex={currentTicketIndex}
            ticketVotesMap={ticketVotesMap}
            onSelectTicket={handleSelectTicket}
            onAddTicket={handleAddTicket}
            onDeleteTicket={handleDeleteTicket}
            onUpdateTicketTitle={handleUpdateTicketTitle}
          />

          {tickets.length > 0 && (
            <Fade in={!!attendeeId} timeout={400}>
              <Box>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 2,
                    mb: 2,
                  }}
                >
                  <Paper
                    component={Button}
                    elevation={1}
                    disabled={currentTicketIndex === 0}
                    onClick={() => handleSelectTicket(currentTicketIndex - 1)}
                    sx={{
                      textTransform: 'none',
                      minWidth: 0,
                      overflow: 'hidden',
                    }}
                  >
                    <Stack sx={{ width: '100%', minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        Previous
                      </Typography>
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          direction: 'rtl',
                          textAlign: 'center',
                        }}
                      >
                        {currentTicketIndex > 0
                          ? tickets[currentTicketIndex - 1]?.title
                          : '—'}
                      </Typography>
                    </Stack>
                  </Paper>
                  <Paper
                    elevation={3}
                    sx={{
                      p: 2,
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      minWidth: 0,
                      overflow: 'hidden',
                    }}
                  >
                    <Typography variant="caption">Current ticket</Typography>
                    <Typography
                      variant="body2"
                      fontWeight="bold"
                      noWrap
                      sx={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        direction: 'rtl',
                        textAlign: 'center',
                      }}
                    >
                      {tickets[currentTicketIndex]?.title}
                    </Typography>
                  </Paper>
                  <Paper
                    component={Button}
                    elevation={1}
                    disabled={currentTicketIndex === tickets.length - 1}
                    onClick={() => handleSelectTicket(currentTicketIndex + 1)}
                    sx={{
                      textTransform: 'none',
                      minWidth: 0,
                      overflow: 'hidden',
                    }}
                  >
                    <Stack sx={{ width: '100%', minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        Next
                      </Typography>
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          direction: 'rtl',
                          textAlign: 'center',
                        }}
                      >
                        {currentTicketIndex < tickets.length - 1
                          ? tickets[currentTicketIndex + 1]?.title
                          : '—'}
                      </Typography>
                    </Stack>
                  </Paper>
                </Box>
              </Box>
            </Fade>
          )}
        </Stack>

        <Box sx={{ flex: 2, minWidth: 0 }}>
          <Fade in={!!attendeeId} timeout={400}>
            <Paper
              elevation={2}
              sx={{ p: 3, mb: 3, minWidth: 0, overflow: 'hidden' }}
            >
              <Stack
                direction={'row'}
                gap={2}
                sx={{ minWidth: 0, overflow: 'hidden' }}
              >
                <Typography variant="h5" gutterBottom sx={{ flexShrink: 0 }}>
                  We are refining:
                </Typography>
                <Typography
                  variant="h5"
                  gutterBottom
                  sx={{
                    color: currentTicket ? 'currentColor' : 'grey',
                    minWidth: 0,
                    display: 'flex',
                    '& > *': {
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  }}
                >
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
                    {currentTicket?.title || 'Nothing yet. Add a ticket!'}
                  </Linkify>
                </Typography>
              </Stack>
              <Stack
                direction={'row'}
                gap={2}
                sx={{ minWidth: 0, overflow: 'hidden' }}
              >
                <Typography variant="body2" color="info">
                  {currentTicket
                    ? currentTicketAverage
                      ? `Voting average: ${currentTicketAverage}`
                      : 'Votes pending...'
                    : '\xa0'}
                </Typography>
                {currentTicket?.estimate && (
                  <Typography variant="body2" color="success">
                    Final Estimate: {currentTicket.estimate}
                  </Typography>
                )}
              </Stack>
            </Paper>
          </Fade>
          <VotingArea
            myVote={myVote}
            voteStatus={voteStatus}
            revealed={revealed}
            attendeeId={attendeeId}
            attendees={attendees}
            currentEstimate={currentTicket?.estimate || null}
            hasCurrentTicket={!!currentTicket}
            onRemoveVote={handleRemoveVote}
            onReveal={handleReveal}
            onUnreveal={handleUnreveal}
            onUpdateName={(name) => {
              const sessionCode = shortId;
              if (!sessionCode || !attendeeId) return;
              fetch(
                `${api.baseUrl}/api/session/${sessionCode}/attendee/${attendeeId}/name`,
                {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name }),
                },
              );
            }}
            onKickPlayer={(playerId) => {
              const sessionCode = shortId;
              if (!sessionCode) return;
              fetch(
                `${api.baseUrl}/api/session/${sessionCode}/attendee/${playerId}/kick`,
                {
                  method: 'POST',
                },
              );
            }}
            onSetEstimate={(estimate) => {
              const sessionCode = shortId;
              if (!sessionCode || !currentTicket) return;
              fetch(
                `${api.baseUrl}/api/session/${sessionCode}/ticket/${currentTicket.id}/estimate`,
                {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ estimate }),
                },
              );
            }}
          />
          <EstimateCards
            myVote={myVote}
            onEstimate={handleVote}
            onRemoveVote={handleRemoveVote}
            disabled={!currentTicket}
          />
        </Box>
      </Stack>
      {!disclaimerDismissed && attendeeId && (
        <Alert
          severity="info"
          onClose={handleDismissDisclaimer}
          sx={{
            position: 'absolute',
            bottom: (theme) => theme.spacing(4),
          }}
        >
          <Typography variant="body2">
            I don't store nothing, boss. No cookies, no database.
            <br />
            Poker sessions are deleted after 24 hours.
            <br />
            However, it's a fabulous idea that you trust this site with NO
            confidential data.
          </Typography>
        </Alert>
      )}
    </Container>
  );
};

export { GameSession };
