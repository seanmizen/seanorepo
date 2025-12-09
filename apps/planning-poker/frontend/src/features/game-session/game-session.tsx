import { ExpandMore, Refresh } from '@mui/icons-material';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Badge,
  Box,
  Button,
  Container,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { type FC, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/config';
import { showSnackbar } from '@/lib';
import { EstimateCards, TicketList, VotingArea } from './components';

type Ticket = {
  id: number;
  title: string;
  description: string;
  estimate: string | null;
  orderIndex: number;
};

type VoteStatus = {
  attendeeId: string;
  hasVoted: boolean;
  vote: string | null;
};

type VotesData = {
  votes: VoteStatus[];
  revealed: boolean;
};

type Attendee = {
  id: string;
  connectionCount: number;
};

const GameSession: FC = () => {
  const { shortId } = useParams<{ shortId: string }>();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [currentTicketIndex, setCurrentTicketIndex] = useState(0);
  const [attendeeId, setAttendeeId] = useState<string>('');
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [voteStatus, setVoteStatus] = useState<VoteStatus[]>([]);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [currentTicketId, setCurrentTicketId] = useState<number | null>(null);

  const fetchVotes = (ticketId: number, currentAttendeeId: string) => {
    if (!shortId) return;
    fetch(
      `${api.baseUrl}/api/session/${shortId}/ticket/${ticketId}/votes?requestingAttendeeId=${encodeURIComponent(currentAttendeeId)}`,
    )
      .then((res) => res.json())
      .then((data: VotesData) => {
        setVoteStatus(data.votes);
        setRevealed(data.revealed);
        const myVoteData = data.votes.find(
          (v) => v.attendeeId === currentAttendeeId,
        );
        setMyVote(myVoteData?.vote || null);
      })
      .catch(() => showSnackbar('Failed to load votes', 'error'));
  };

  const refreshGameState = async () => {
    if (!shortId || !attendeeId) return;
    try {
      const [sessionRes, attendeesRes] = await Promise.all([
        fetch(`${api.baseUrl}/api/session/${shortId}`),
        fetch(`${api.baseUrl}/api/session/${shortId}/attendees`),
      ]);
      const sessionData = await sessionRes.json();
      const attendeesData = await attendeesRes.json();

      setTickets(sessionData.tickets);
      setAttendees(attendeesData.attendees);
      const currentIndex = sessionData.currentTicketIndex ?? 0;
      setCurrentTicketIndex(currentIndex);

      const currentTicket = sessionData.tickets[currentIndex];
      if (currentTicket) {
        setCurrentTicketId(currentTicket.id);
        fetchVotes(currentTicket.id, attendeeId);
      }

      showSnackbar('Refreshed', 'success');
    } catch {
      showSnackbar('Failed to refresh', 'error');
    }
  };

  useEffect(() => {
    if (!shortId) return;
    fetch(`${api.baseUrl}/api/session/${shortId}`)
      .then((res) => res.json())
      .then((data) => {
        setTickets(data.tickets);
        if (data.tickets.length > 0) {
          setCurrentTicketId(data.tickets[0].id);
        }
      })
      .catch(() => showSnackbar('Failed to load session', 'error'));

    const storedAttendeeId = localStorage.getItem(`attendee-${shortId}`);
    const wsUrl = storedAttendeeId
      ? `${api.wsUrl}/ws/${shortId}?existingAttendeeId=${encodeURIComponent(storedAttendeeId)}`
      : `${api.wsUrl}/ws/${shortId}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'attendee:id') {
        setAttendeeId(message.attendeeId);
        localStorage.setItem(`attendee-${shortId}`, message.attendeeId);
        setCurrentTicketId((currentId) => {
          if (currentId) {
            fetchVotes(currentId, message.attendeeId);
          }
          return currentId;
        });
      } else if (message.type === 'attendees:updated') {
        fetch(`${api.baseUrl}/api/session/${shortId}/attendees`)
          .then((res) => res.json())
          .then((data) => setAttendees(data.attendees))
          .catch(() => showSnackbar('Failed to load attendees', 'error'));
        if (tickets.length > 0) {
          const currentTicket = tickets[currentTicketIndex] || tickets[0];
          setAttendeeId((currentAttendeeId) => {
            if (currentAttendeeId) {
              fetchVotes(currentTicket.id, currentAttendeeId);
            }
            return currentAttendeeId;
          });
        }
      } else if (message.type === 'votes:updated') {
        setCurrentTicketId((currentId) => {
          if (currentId === message.ticketId) {
            setAttendeeId((currentAttendeeId) => {
              if (currentAttendeeId) {
                fetchVotes(message.ticketId, currentAttendeeId);
              }
              return currentAttendeeId;
            });
          }
          return currentId;
        });
      } else if (message.type === 'votes:revealed') {
        setCurrentTicketId((currentId) => {
          if (currentId === message.ticketId) {
            setRevealed(true);
            setAttendeeId((currentAttendeeId) => {
              if (currentAttendeeId) {
                fetchVotes(message.ticketId, currentAttendeeId);
              }
              return currentAttendeeId;
            });
          }
          return currentId;
        });
      } else if (message.type === 'votes:unrevealed') {
        setCurrentTicketId((currentId) => {
          if (currentId === message.ticketId) {
            setRevealed(false);
            setAttendeeId((currentAttendeeId) => {
              if (currentAttendeeId) {
                fetchVotes(message.ticketId, currentAttendeeId);
              }
              return currentAttendeeId;
            });
          }
          return currentId;
        });
      } else if (message.type === 'ticket:added') {
        setTickets((prev) => {
          if (prev.find((t) => t.id === message.ticket.id)) return prev;
          return [...prev, message.ticket];
        });
      } else if (message.type === 'ticket:updated') {
        setTickets((prev) =>
          prev.map((t) =>
            t.id === message.ticketId
              ? { ...t, estimate: message.estimate }
              : t,
          ),
        );
      } else if (message.type === 'current-ticket:changed') {
        setCurrentTicketIndex(message.ticketIndex);
        setTickets((currentTickets) => {
          if (currentTickets[message.ticketIndex]) {
            const newTicket = currentTickets[message.ticketIndex];
            setCurrentTicketId(newTicket.id);
            setAttendeeId((currentAttendeeId) => {
              if (currentAttendeeId) {
                fetchVotes(newTicket.id, currentAttendeeId);
              }
              return currentAttendeeId;
            });
          }
          return currentTickets;
        });
      } else if (message.type === 'ticket:deleted') {
        setTickets((prev) => prev.filter((t) => t.id !== message.ticketId));
      }
    };
    return () => ws.close();
  }, [shortId]);

  const handleAddTicket = async (title: string) => {
    if (!shortId) return;
    try {
      await fetch(`${api.baseUrl}/api/session/${shortId}/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    } catch {
      showSnackbar('Failed to add ticket', 'error');
    }
  };

  const handleDeleteTicket = async (id: number) => {
    if (!shortId) return;
    const deletingCurrentTicket = tickets[currentTicketIndex]?.id === id;
    const newTickets = tickets.filter((t) => t.id !== id);

    if (deletingCurrentTicket && newTickets.length > 0) {
      const newIndex = Math.min(currentTicketIndex, newTickets.length - 1);
      await handleSelectTicket(newIndex);
    } else if (newTickets.length === 0) {
      setCurrentTicketIndex(0);
      setVoteStatus([]);
    }

    try {
      await fetch(`${api.baseUrl}/api/session/${shortId}/ticket/${id}`, {
        method: 'DELETE',
      });
    } catch {
      showSnackbar('Failed to delete ticket', 'error');
    }
  };

  const handleVote = async (vote: string) => {
    const ticket = tickets[currentTicketIndex];
    if (!ticket || !shortId || !attendeeId) return;
    try {
      await fetch(
        `${api.baseUrl}/api/session/${shortId}/ticket/${ticket.id}/vote`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vote, attendeeId }),
        },
      );
      setMyVote(vote);
    } catch {
      showSnackbar('Failed to save vote', 'error');
    }
  };

  const handleRemoveVote = async () => {
    const ticket = tickets[currentTicketIndex];
    if (!ticket || !shortId || !attendeeId) return;
    try {
      await fetch(
        `${api.baseUrl}/api/session/${shortId}/ticket/${ticket.id}/vote`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vote: null, attendeeId }),
        },
      );
      setMyVote(null);
    } catch {
      showSnackbar('Failed to remove vote', 'error');
    }
  };

  const handleReveal = async () => {
    const ticket = tickets[currentTicketIndex];
    if (!ticket || !shortId) return;
    try {
      await fetch(
        `${api.baseUrl}/api/session/${shortId}/ticket/${ticket.id}/reveal`,
        {
          method: 'POST',
        },
      );
    } catch {
      showSnackbar('Failed to reveal votes', 'error');
    }
  };

  const handleUnreveal = async () => {
    const ticket = tickets[currentTicketIndex];
    if (!ticket || !shortId) return;
    try {
      await fetch(
        `${api.baseUrl}/api/session/${shortId}/ticket/${ticket.id}/unreveal`,
        {
          method: 'POST',
        },
      );
    } catch {
      showSnackbar('Failed to hide votes', 'error');
    }
  };

  const handleSelectTicket = async (index: number) => {
    const ticket = tickets[index];
    if (!shortId || !ticket) return;

    setCurrentTicketIndex(index);
    setCurrentTicketId(ticket.id);
    if (attendeeId) {
      fetchVotes(ticket.id, attendeeId);
    }

    try {
      const res = await fetch(
        `${api.baseUrl}/api/session/${shortId}/current-ticket`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketIndex: index }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      showSnackbar('Failed to sync ticket selection', 'error');
    }
  };

  const currentTicket = tickets[currentTicketIndex];

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
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {attendeeId && (
            <Typography variant="body2" color="text.secondary">
              Your ID: <code>{attendeeId.slice(-8)}</code>
            </Typography>
          )}
          <Tooltip title="Refresh game state">
            <IconButton onClick={refreshGameState} size="small" color="primary">
              <Refresh />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex',
          gap: { xs: 2, md: 3 },
          flexDirection: { xs: 'column', md: 'row' },
        }}
      >
        <Stack spacing={{ xs: 2, md: 3 }} sx={{ flex: 1 }}>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="h6">
                Attendees ({attendees.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {attendees.map((attendee) => {
                const status = voteStatus.find(
                  (v) => v.attendeeId === attendee.id,
                );
                const isMe = attendee.id === attendeeId;
                return (
                  <Box
                    key={attendee.id}
                    sx={{
                      display: 'flex',
                      gap: 1,
                      mb: 1,
                      alignItems: 'center',
                    }}
                  >
                    <Tooltip
                      title={
                        attendee.connectionCount > 1
                          ? `[ATTENDEE NAME] HAS ${attendee.connectionCount} TABS OPEN!`
                          : ''
                      }
                      arrow
                    >
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
                        {/** biome-ignore lint/complexity/noUselessFragments: no it isn't */}
                        <>
                          <Avatar />
                          <Typography
                            variant="body2"
                            fontWeight={isMe ? 'bold' : 'normal'}
                          >
                            {attendee.id.slice(-4)}
                            {isMe ? ' (you)' : ''}:
                          </Typography>
                        </>
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
                );
              })}
            </AccordionDetails>
          </Accordion>

          <TicketList
            tickets={tickets}
            currentIndex={currentTicketIndex}
            onSelectTicket={handleSelectTicket}
            onAddTicket={handleAddTicket}
            onDeleteTicket={handleDeleteTicket}
          />

          {tickets.length > 0 && (
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
                  elevation={1}
                  sx={{ p: 2, opacity: currentTicketIndex > 0 ? 1 : 0.3 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Previous
                  </Typography>
                  <Typography variant="body2" noWrap>
                    {currentTicketIndex > 0
                      ? tickets[currentTicketIndex - 1].title
                      : '—'}
                  </Typography>
                </Paper>
                <Paper
                  elevation={3}
                  sx={{
                    p: 2,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                  }}
                >
                  <Typography variant="caption">Current</Typography>
                  <Typography variant="body2" fontWeight="bold" noWrap>
                    {tickets[currentTicketIndex].title}
                  </Typography>
                </Paper>
                <Paper
                  elevation={1}
                  sx={{
                    p: 2,
                    opacity: currentTicketIndex < tickets.length - 1 ? 1 : 0.3,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Next
                  </Typography>
                  <Typography variant="body2" noWrap>
                    {currentTicketIndex < tickets.length - 1
                      ? tickets[currentTicketIndex + 1].title
                      : '—'}
                  </Typography>
                </Paper>
              </Box>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button
                  variant="outlined"
                  fullWidth
                  disabled={currentTicketIndex === 0}
                  onClick={() => handleSelectTicket(currentTicketIndex - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outlined"
                  fullWidth
                  disabled={currentTicketIndex === tickets.length - 1}
                  onClick={() => handleSelectTicket(currentTicketIndex + 1)}
                >
                  Next
                </Button>
              </Box>
            </Box>
          )}
        </Stack>

        <Box sx={{ flex: 2 }}>
          {currentTicket && (
            <>
              <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
                <Typography variant="h5" gutterBottom>
                  {currentTicket.title}
                </Typography>
                {currentTicket.estimate && (
                  <Typography variant="body2" color="success.main">
                    Estimate: {currentTicket.estimate}
                  </Typography>
                )}
              </Paper>
              <VotingArea
                myVote={myVote}
                voteStatus={voteStatus}
                revealed={revealed}
                attendeeId={attendeeId}
                onRemoveVote={handleRemoveVote}
                onReveal={handleReveal}
                onUnreveal={handleUnreveal}
              />
            </>
          )}
          <EstimateCards onEstimate={handleVote} />
        </Box>
      </Box>
    </Container>
  );
};

export { GameSession };
