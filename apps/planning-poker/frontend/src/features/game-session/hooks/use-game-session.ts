import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/config';
import { showSnackbar } from '@/lib';

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
  name: string | null;
};

type VotesData = {
  votes: VoteStatus[];
  revealed: boolean;
};

type Attendee = {
  id: string;
  connectionCount: number;
  name: string | null;
};

type SessionData = {
  tickets: Ticket[];
  currentTicketIndex: number;
  disclaimerDismissed: boolean;
  wasCreated?: boolean;
};

const useGameSession = (shortId: string | null) => {
  const queryClient = useQueryClient();
  const [attendeeId, setAttendeeId] = useState<string>('');
  const [sessionCreated, setSessionCreated] = useState(false);

  // Queries
  const { data: sessionData } = useQuery({
    queryKey: ['session', shortId, attendeeId],
    queryFn: async (): Promise<SessionData & { attendees: Attendee[] }> => {
      const storedAttendeeId = localStorage.getItem(`attendee-${shortId}`);

      let url = `${api.baseUrl}/api/session/${shortId}`;
      if (storedAttendeeId) {
        url += `?attendeeId=${encodeURIComponent(storedAttendeeId)}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load session');
      const data = await res.json();

      if (!sessionCreated && data.wasCreated) {
        setSessionCreated(true);
        showSnackbar(
          `Session not found, new session ${shortId} created`,
          'info',
        );
      }

      return data;
    },
    enabled: !!shortId,
  });

  const tickets = sessionData?.tickets || [];
  const currentTicketIndex = sessionData?.currentTicketIndex || 0;
  const attendees = sessionData?.attendees || [];
  const currentTicket = tickets[currentTicketIndex];
  const disclaimerDismissed = sessionData?.disclaimerDismissed ?? null;

  // Fetch votes for all tickets in a single query
  const ticketIds = tickets.map((t) => t.id).join(',');
  const { data: allTicketVotes } = useQuery({
    queryKey: ['all-votes', shortId, ticketIds],
    queryFn: async (): Promise<Map<number, VotesData>> => {
      const results = await Promise.all(
        tickets.map(async (ticket) => {
          const res = await fetch(
            `${api.baseUrl}/api/session/${shortId}/ticket/${ticket.id}/votes`,
          );
          if (!res.ok) throw new Error('Failed to load votes');
          const data = await res.json();
          return [ticket.id, data] as [number, VotesData];
        }),
      );
      return new Map(results);
    },
    enabled: !!shortId && tickets.length > 0,
  });

  const ticketVotesMap = allTicketVotes || new Map<number, VotesData>();

  const { data: votesData } = useQuery({
    queryKey: ['votes', shortId, currentTicket?.id, attendeeId],
    queryFn: async (): Promise<VotesData> => {
      const res = await fetch(
        `${api.baseUrl}/api/session/${shortId}/ticket/${currentTicket!.id}/votes?requestingAttendeeId=${encodeURIComponent(attendeeId)}`,
      );
      if (!res.ok) throw new Error('Failed to load votes');
      return res.json();
    },
    enabled: !!shortId && !!currentTicket?.id && !!attendeeId,
  });

  // Always show vote status for all attendees, even when no ticket
  const voteStatus =
    currentTicket?.id && votesData?.votes
      ? votesData.votes
      : attendees.map((attendee) => ({
          attendeeId: attendee.id,
          hasVoted: false,
          vote: null,
          name: attendee.name,
        }));
  const revealed = votesData?.revealed || false;
  const myVote =
    voteStatus.find((v) => v.attendeeId === attendeeId)?.vote || null;

  // Mutations
  const addTicketMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await fetch(`${api.baseUrl}/api/session/${shortId}/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to add ticket');
    },
    onError: () => showSnackbar('Failed to add ticket', 'error'),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['session', shortId] }),
  });

  const deleteTicketMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(
        `${api.baseUrl}/api/session/${shortId}/ticket/${id}`,
        {
          method: 'DELETE',
        },
      );
      if (!res.ok) throw new Error('Failed to delete ticket');
    },
    onError: () => showSnackbar('Failed to delete ticket', 'error'),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['session', shortId] }),
  });

  const voteMutation = useMutation({
    mutationFn: async ({
      vote,
      attendeeId,
    }: {
      vote: string | null;
      attendeeId: string;
    }) => {
      const res = await fetch(
        `${api.baseUrl}/api/session/${shortId}/ticket/${currentTicket!.id}/vote`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vote, attendeeId }),
        },
      );
      if (!res.ok) throw new Error('Failed to save vote');
    },
    onError: () => showSnackbar('Failed to save vote', 'error'),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['votes', shortId, currentTicket?.id],
      }),
  });

  const revealMutation = useMutation<void, Error, boolean>({
    mutationFn: async (revealed: boolean) => {
      const res = await fetch(
        `${api.baseUrl}/api/session/${shortId}/ticket/${currentTicket!.id}/reveal`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revealed }),
        },
      );
      if (!res.ok) throw new Error('Failed to update reveal status');
    },
    onError: () => showSnackbar('Failed to update reveal status', 'error'),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['votes', shortId, currentTicket?.id],
      }),
  });

  const selectTicketMutation = useMutation({
    mutationFn: async ({ index, attendeeId }: { index: number; attendeeId: string }) => {
      const res = await fetch(
        `${api.baseUrl}/api/session/${shortId}/current-ticket`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketIndex: index, attendeeId }),
        },
      );
      if (!res.ok) throw new Error('Failed to sync ticket selection');
    },
    onError: () => showSnackbar('Failed to sync ticket selection', 'error'),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['session', shortId] }),
  });

  const dismissDisclaimerMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `${api.baseUrl}/api/session/${shortId}/attendee/${attendeeId}/disclaimer`,
        { method: 'PUT' },
      );
      if (!res.ok) throw new Error('Failed to dismiss disclaimer');
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['session', shortId] }),
  });

  const updateTicketTitleMutation = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const res = await fetch(
        `${api.baseUrl}/api/session/${shortId}/ticket/${id}/title`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        },
      );
      if (!res.ok) throw new Error('Failed to update ticket title');
    },
    onError: () => showSnackbar('Failed to update ticket title', 'error'),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['session', shortId] }),
  });

  // WebSocket setup
  useEffect(() => {
    if (!shortId) return;

    const storedAttendeeId = localStorage.getItem(`attendee-${shortId}`);

    let wsUrl = `${api.wsUrl}/ws/${shortId}`;
    if (storedAttendeeId) {
      wsUrl += `?existingAttendeeId=${encodeURIComponent(storedAttendeeId)}`;
    }

    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'attendee:id') {
        setAttendeeId(message.attendeeId);
        localStorage.setItem(`attendee-${shortId}`, message.attendeeId);
      } else if (message.type === 'refresh') {
        queryClient.invalidateQueries({ queryKey: ['session', shortId] });
        queryClient.invalidateQueries({ queryKey: ['votes', shortId] });
        queryClient.invalidateQueries({ queryKey: ['all-votes', shortId] });
      } else if (message.type === 'ticket-changed') {
        showSnackbar(`${message.changedBy} changed ticket to: ${message.ticketTitle}`, 'info');
        queryClient.invalidateQueries({ queryKey: ['session', shortId] });
        queryClient.invalidateQueries({ queryKey: ['votes', shortId] });
        queryClient.invalidateQueries({ queryKey: ['all-votes', shortId] });
      } else if (message.type === 'kicked') {
        alert('You were kicked 👢');
        window.location.href = '/';
      }
    };
    return () => ws.close();
  }, [shortId, queryClient]);

  // Handler functions
  const handleAddTicket = (title: string) => {
    addTicketMutation.mutate(title);
  };

  const handleDeleteTicket = (id: number) => {
    const deletingCurrentTicket = tickets[currentTicketIndex]?.id === id;
    const newTickets = tickets.filter((t) => t.id !== id);

    if (deletingCurrentTicket && newTickets.length > 0) {
      const newIndex = Math.min(currentTicketIndex, newTickets.length - 1);
      selectTicketMutation.mutate({ index: newIndex, attendeeId });
    }

    deleteTicketMutation.mutate(id);
  };

  const handleVote = (vote: string) => {
    if (!attendeeId) return;
    voteMutation.mutate({ vote, attendeeId });
  };

  const handleRemoveVote = () => {
    if (!attendeeId) return;
    voteMutation.mutate({ vote: null, attendeeId });
  };

  const handleReveal = () => {
    revealMutation.mutate(true);
  };

  const handleUnreveal = () => {
    revealMutation.mutate(false);
  };

  const handleSelectTicket = (index: number) => {
    selectTicketMutation.mutate({ index, attendeeId });
  };

  const handleRefresh = () => {
    if (!shortId) return;
    queryClient.invalidateQueries({ queryKey: ['session', shortId] });
    queryClient.invalidateQueries({ queryKey: ['votes', shortId] });
    queryClient.invalidateQueries({ queryKey: ['all-votes', shortId] });
    showSnackbar('Refreshed', 'success');
  };

  const handleDismissDisclaimer = () => {
    dismissDisclaimerMutation.mutate();
  };

  const handleUpdateTicketTitle = (id: number, title: string) => {
    updateTicketTitleMutation.mutate({ id, title });
  };

  return {
    // Data
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

    // Handlers
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
  };
};

export { useGameSession };
export type { Ticket, VoteStatus, Attendee };
