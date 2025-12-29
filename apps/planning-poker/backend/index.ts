import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';
import { type ConfigType, configs } from '../configs';

type Env = keyof typeof configs;

const getEnv = (value: string | undefined): Env => {
  return value === 'production' ? 'production' : 'development';
};

const env = getEnv(process.env.NODE_ENV);
const config: ConfigType = configs[env];

const fastify = Fastify<Server, IncomingMessage, ServerResponse>({
  logger: { level: 'error' },
});

fastify.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});
fastify.register(websocket);

type Ticket = {
  id: number;
  title: string;
  description: string;
  estimate: string | null;
};

type GameSession = {
  id: string;
  shortId: string;
  tickets: Ticket[];
  currentTicketIndex: number;
  votes: Map<number, Map<string, string>>;
  revealed: Map<number, boolean>;
  createdAt: number;
};

const sessions = new Map<string, GameSession>();
const sessionClients = new Map<string, Set<WebSocket>>();
const attendeeConnectionCount = new Map<string, Map<string, number>>();
const attendeeNames = new Map<string, Map<string, string>>();
const attendeeDisclaimerDismissed = new Map<string, Set<string>>();
const attendeeToWebSocket = new Map<string, Map<string, WebSocket>>();

let ticketIdCounter = 1;

const broadcast = (
  shortId: string,
  message?: { type: string; changedBy?: string; ticketTitle?: string },
) => {
  try {
    const clients = sessionClients.get(shortId);
    if (!clients) return;
    const data = JSON.stringify(message || { type: 'refresh' });
    for (const client of clients) {
      try {
        if (client.readyState === 1) client.send(data);
      } catch (err) {
        console.error('Failed to send message to client:', err);
      }
    }
  } catch (err) {
    console.error('Broadcast error:', err);
  }
};

fastify.get('/', async (_request, _reply) => {
  return { status: 'ok' };
});

fastify.post('/api/game-session', async (_request, reply) => {
  const id = randomUUID();
  const shortId = id.slice(-4);
  sessions.set(shortId, {
    id,
    shortId,
    tickets: [],
    currentTicketIndex: 0,
    votes: new Map(),
    revealed: new Map(),
    createdAt: Date.now(),
  });
  reply.send({ id, shortId });
});

fastify.put(
  '/api/session/:shortId/attendee/:attendeeId/name',
  async (request, reply) => {
    const { shortId, attendeeId } = request.params as {
      shortId: string;
      attendeeId: string;
    };
    const { name } = request.body as { name: string };

    if (!attendeeNames.has(shortId)) {
      attendeeNames.set(shortId, new Map());
    }
    attendeeNames.get(shortId)?.set(attendeeId, name);

    broadcast(shortId);
    reply.send({ success: true });
  },
);

fastify.put(
  '/api/session/:shortId/attendee/:attendeeId/disclaimer',
  async (request, reply) => {
    const { shortId, attendeeId } = request.params as {
      shortId: string;
      attendeeId: string;
    };

    if (!attendeeDisclaimerDismissed.has(shortId)) {
      attendeeDisclaimerDismissed.set(shortId, new Set());
    }
    attendeeDisclaimerDismissed.get(shortId)?.add(attendeeId);

    broadcast(shortId);
    reply.send({ success: true });
  },
);

fastify.get(
  '/api/session/:shortId/attendee/:attendeeId/disclaimer',
  async (request, reply) => {
    const { shortId, attendeeId } = request.params as {
      shortId: string;
      attendeeId: string;
    };

    const dismissed =
      attendeeDisclaimerDismissed.get(shortId)?.has(attendeeId) || false;
    reply.send({ dismissed });
  },
);

fastify.get('/api/session/:shortId', async (request, reply) => {
  const { shortId } = request.params as { shortId: string };
  const { attendeeId } = request.query as { attendeeId?: string };

  let session = sessions.get(shortId);
  let wasCreated = false;
  if (!session) {
    const id = randomUUID();
    session = {
      id,
      shortId,
      tickets: [],
      currentTicketIndex: 0,
      votes: new Map(),
      revealed: new Map(),
      createdAt: Date.now(),
    };
    sessions.set(shortId, session);
    wasCreated = true;
  }

  const counts = attendeeConnectionCount.get(shortId);
  const names = attendeeNames.get(shortId);
  const attendees = counts
    ? Array.from(counts.entries()).map(([id, count]) => ({
        id,
        connectionCount: count,
        name: names?.get(id) || null,
      }))
    : [];

  const disclaimerDismissed = attendeeId
    ? attendeeDisclaimerDismissed.get(shortId)?.has(attendeeId) || false
    : false;

  reply.send({
    session: { id: session.id, shortId: session.shortId },
    tickets: session.tickets,
    currentTicketIndex: session.currentTicketIndex,
    attendees,
    disclaimerDismissed,
    wasCreated,
  });
});

fastify.post('/api/session/:shortId/ticket', async (request, reply) => {
  const { shortId } = request.params as { shortId: string };
  const { title, description } = request.body as {
    title: string;
    description?: string;
  };

  const session = sessions.get(shortId);
  if (!session) {
    reply.code(404).send({ error: 'Session not found' });
    return;
  }

  const ticket: Ticket = {
    id: ticketIdCounter++,
    title,
    description: description || '',
    estimate: null,
  };

  session.tickets.push(ticket);
  broadcast(shortId);
  reply.send(ticket);
});

fastify.put('/api/session/:shortId/ticket/:id/vote', async (request, reply) => {
  const { shortId, id } = request.params as { shortId: string; id: string };
  const { vote, attendeeId } = request.body as {
    vote: string | null;
    attendeeId: string;
  };

  const session = sessions.get(shortId);
  if (!session) {
    reply.code(404).send({ error: 'Session not found' });
    return;
  }

  if (!session.votes.has(Number(id))) {
    session.votes.set(Number(id), new Map());
  }

  if (vote === null) {
    session.votes.get(Number(id))?.delete(attendeeId);
  } else {
    session.votes.get(Number(id))?.set(attendeeId, vote);
  }

  broadcast(shortId);
  reply.send({ success: true });
});

fastify.put(
  '/api/session/:shortId/ticket/:id/reveal',
  async (request, reply) => {
    const { shortId, id } = request.params as { shortId: string; id: string };
    const { revealed } = request.body as { revealed: boolean };

    const session = sessions.get(shortId);
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }

    session.revealed.set(Number(id), revealed);
    broadcast(shortId);
    reply.send({ success: true });
  },
);

fastify.put(
  '/api/session/:shortId/ticket/:id/estimate',
  async (request, reply) => {
    const { shortId, id } = request.params as { shortId: string; id: string };
    const { estimate } = request.body as { estimate: string | null };

    const session = sessions.get(shortId);
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }

    const ticket = session.tickets.find((t) => t.id === Number(id));
    if (ticket) {
      ticket.estimate = estimate || null;
    }

    broadcast(shortId);
    reply.send({ success: true });
  },
);

fastify.put(
  '/api/session/:shortId/ticket/:id/title',
  async (request, reply) => {
    const { shortId, id } = request.params as { shortId: string; id: string };
    const { title } = request.body as { title: string };

    const session = sessions.get(shortId);
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }

    const ticket = session.tickets.find((t) => t.id === Number(id));
    if (ticket) {
      ticket.title = title;
    }

    broadcast(shortId);
    reply.send({ success: true });
  },
);

fastify.put('/api/session/:shortId/current-ticket', async (request, reply) => {
  const { shortId } = request.params as { shortId: string };
  const { ticketIndex, attendeeId } = request.body as {
    ticketIndex: number;
    attendeeId?: string;
  };

  const session = sessions.get(shortId);
  if (!session) {
    reply.code(404).send({ error: 'Session not found' });
    return;
  }

  session.currentTicketIndex = ticketIndex;

  const names = attendeeNames.get(shortId);
  const changedBy = attendeeId
    ? names?.get(attendeeId) || attendeeId.slice(-4)
    : 'Someone';
  const ticketTitle = session.tickets[ticketIndex]?.title || 'Unknown';

  broadcast(shortId, { type: 'ticket-changed', changedBy, ticketTitle });
  reply.send({ success: true });
});

fastify.delete('/api/session/:shortId/ticket/:id', async (request, reply) => {
  const { shortId, id } = request.params as { shortId: string; id: string };

  const session = sessions.get(shortId);
  if (!session) {
    reply.code(404).send({ error: 'Session not found' });
    return;
  }

  session.tickets = session.tickets.filter((t) => t.id !== Number(id));
  broadcast(shortId);
  reply.send({ success: true });
});

fastify.get(
  '/api/session/:shortId/ticket/:id/votes',
  async (request, reply) => {
    const { shortId, id } = request.params as { shortId: string; id: string };
    const { requestingAttendeeId } = request.query as {
      requestingAttendeeId?: string;
    };

    const session = sessions.get(shortId);
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }

    const votes = session.votes.get(Number(id));
    const revealed = session.revealed.get(Number(id)) || false;
    const counts = attendeeConnectionCount.get(shortId);
    const names = attendeeNames.get(shortId);
    const attendeeList = counts ? Array.from(counts.keys()) : [];
    const voteStatus = attendeeList.map((attendeeId) => ({
      attendeeId,
      hasVoted: votes?.has(attendeeId) || false,
      vote:
        revealed || attendeeId === requestingAttendeeId
          ? votes?.get(attendeeId) || null
          : null,
      name: names?.get(attendeeId) || null,
    }));
    reply.send({ votes: voteStatus, revealed });
  },
);

fastify.post(
  '/api/session/:shortId/attendee/:attendeeId/kick',
  async (request, reply) => {
    const { shortId, attendeeId } = request.params as {
      shortId: string;
      attendeeId: string;
    };

    const wsMap = attendeeToWebSocket.get(shortId);
    const socket = wsMap?.get(attendeeId);
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: 'kicked' }));
      socket.close();
    }

    // Clean up attendee data immediately
    attendeeConnectionCount.get(shortId)?.delete(attendeeId);
    attendeeNames.get(shortId)?.delete(attendeeId);
    attendeeDisclaimerDismissed.get(shortId)?.delete(attendeeId);
    attendeeToWebSocket.get(shortId)?.delete(attendeeId);

    broadcast(shortId);
    reply.send({ success: true });
  },
);

fastify.register(async (fastify) => {
  fastify.get('/ws/:shortId', { websocket: true }, (socket, request) => {
    const { shortId } = request.params as { shortId: string };
    const { existingAttendeeId } = request.query as {
      existingAttendeeId?: string;
    };
    const attendeeId = existingAttendeeId || randomUUID();

    if (!sessionClients.has(shortId)) {
      sessionClients.set(shortId, new Set());
    }
    if (!attendeeConnectionCount.has(shortId)) {
      attendeeConnectionCount.set(shortId, new Map());
    }
    if (!attendeeNames.has(shortId)) {
      attendeeNames.set(shortId, new Map());
    }
    if (!attendeeToWebSocket.has(shortId)) {
      attendeeToWebSocket.set(shortId, new Map());
    }

    sessionClients.get(shortId)?.add(socket);
    attendeeToWebSocket.get(shortId)?.set(attendeeId, socket);

    const counts = attendeeConnectionCount.get(shortId);
    if (counts) {
      counts.set(attendeeId, (counts.get(attendeeId) || 0) + 1);
    }

    socket.send(JSON.stringify({ type: 'attendee:id', attendeeId }));
    broadcast(shortId);

    socket.on('close', () => {
      sessionClients.get(shortId)?.delete(socket);
      attendeeToWebSocket.get(shortId)?.delete(attendeeId);

      const counts = attendeeConnectionCount.get(shortId);
      if (counts) {
        const currentCount = counts.get(attendeeId) || 0;
        counts.set(attendeeId, Math.max(0, currentCount - 1));
      }

      broadcast(shortId);
    });
  });
});

const reset = '\x1b[0m';
const cyan = '\x1b[36m';
const bright = '\x1b[1m';

// Clean up sessions older than 24 hours
const cleanupOldSessions = () => {
  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;

  for (const [shortId, session] of sessions.entries()) {
    if (now - session.createdAt > twentyFourHours) {
      sessions.delete(shortId);
      sessionClients.delete(shortId);
      attendeeConnectionCount.delete(shortId);
      attendeeNames.delete(shortId);
      attendeeDisclaimerDismissed.delete(shortId);
      attendeeToWebSocket.delete(shortId);
      console.log(`Cleaned up session ${shortId} (older than 24 hours)`);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

const start = async () => {
  try {
    process.on('SIGINT', async () => {
      await fastify.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await fastify.close();
      process.exit(0);
    });

    const port = process.env.PORT
      ? Number(process.env.PORT)
      : config.backendPort;
    const listenText = `Bun serving at ${[
      cyan,
      'http://localhost:',
      bright,
      port,
      reset,
    ].join('')}`;
    await fastify.listen({
      host: '0.0.0.0',
      port,
      listenTextResolver: () => listenText,
    });
    console.debug(listenText);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
