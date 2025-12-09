import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';
import { type ConfigType, configs } from '../configs';
import { db } from './db';

const env = process.env.NODE_ENV || 'development';
const config: ConfigType = configs[env];

const fastify = Fastify<Server, IncomingMessage, ServerResponse>({
  logger: { level: 'error' },
});

fastify.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});
fastify.register(formbody);
fastify.register(cookie, { secret: 'super', hook: 'onRequest' });
fastify.register(jwt, { secret: 'super' });
fastify.register(websocket);

const sessionClients = new Map<string, Set<WebSocket>>();
const sessionAttendees = new Map<string, Map<WebSocket, string>>();
const attendeeConnectionCount = new Map<string, Map<string, number>>();
const ticketVotes = new Map<string, Map<number, Map<string, string>>>();
const ticketRevealed = new Map<string, Map<number, boolean>>();

const broadcast = (shortId: string, message: unknown) => {
  const clients = sessionClients.get(shortId);
  if (!clients) return;
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) client.send(data);
  }
};

fastify.get('/', async (_request, _reply) => {
  return { status: 'ok' };
});

fastify.post('/api/user-session', async (_request, reply) => {
  const token = randomUUID();
  const result = db
    .query('INSERT INTO user_sessions (sessionToken) VALUES (?) RETURNING id')
    .get(token) as { id: number };
  reply.send({ id: result.id, token });
});

fastify.post('/api/game-session', async (_request, reply) => {
  const id = randomUUID();
  const shortId = id.slice(-4);
  db.query('INSERT INTO game_sessions (id, shortId) VALUES (?, ?)').run(
    id,
    shortId,
  );
  reply.send({ id, shortId });
});

fastify.get('/api/session/:shortId', async (request, reply) => {
  const { shortId } = request.params as { shortId: string };
  const session = db
    .query('SELECT * FROM game_sessions WHERE shortId = ?')
    .get(shortId);
  if (!session) {
    reply.code(404).send({ error: 'Session not found' });
    return;
  }
  const tickets = db
    .query('SELECT * FROM tickets WHERE gameSessionId = ? ORDER BY orderIndex')
    .all((session as { id: string }).id);
  reply.send({ session, tickets });
});

fastify.post('/api/session/:shortId/ticket', async (request, reply) => {
  const { shortId } = request.params as { shortId: string };
  const { title, description } = request.body as {
    title: string;
    description?: string;
  };
  const session = db
    .query('SELECT * FROM game_sessions WHERE shortId = ?')
    .get(shortId) as { id: string } | undefined;
  if (!session) {
    reply.code(404).send({ error: 'Session not found' });
    return;
  }
  const maxOrder = db
    .query('SELECT MAX(orderIndex) as max FROM tickets WHERE gameSessionId = ?')
    .get(session.id) as { max: number | null };
  const orderIndex = (maxOrder.max ?? -1) + 1;
  const result = db
    .query(
      'INSERT INTO tickets (gameSessionId, title, description, orderIndex) VALUES (?, ?, ?, ?) RETURNING *',
    )
    .get(session.id, title, description || '', orderIndex);
  broadcast(shortId, { type: 'ticket:added', ticket: result });
  reply.send(result);
});

fastify.put('/api/session/:shortId/ticket/:id/vote', async (request, reply) => {
  const { shortId, id } = request.params as { shortId: string; id: string };
  const { vote, attendeeId } = request.body as { vote: string | null; attendeeId: string };
  
  if (!ticketVotes.has(shortId)) {
    ticketVotes.set(shortId, new Map());
  }
  if (!ticketVotes.get(shortId)?.has(Number(id))) {
    ticketVotes.get(shortId)?.set(Number(id), new Map());
  }
  
  if (vote === null) {
    ticketVotes.get(shortId)?.get(Number(id))?.delete(attendeeId);
  } else {
    ticketVotes.get(shortId)?.get(Number(id))?.set(attendeeId, vote);
  }
  
  broadcast(shortId, { type: 'votes:updated', ticketId: Number(id) });
  reply.send({ success: true });
});

fastify.post('/api/session/:shortId/ticket/:id/reveal', async (request, reply) => {
  const { shortId, id } = request.params as { shortId: string; id: string };
  
  if (!ticketRevealed.has(shortId)) {
    ticketRevealed.set(shortId, new Map());
  }
  ticketRevealed.get(shortId)?.set(Number(id), true);
  
  broadcast(shortId, { type: 'votes:revealed', ticketId: Number(id) });
  reply.send({ success: true });
});

fastify.post('/api/session/:shortId/ticket/:id/unreveal', async (request, reply) => {
  const { shortId, id } = request.params as { shortId: string; id: string };
  
  if (!ticketRevealed.has(shortId)) {
    ticketRevealed.set(shortId, new Map());
  }
  ticketRevealed.get(shortId)?.set(Number(id), false);
  
  broadcast(shortId, { type: 'votes:unrevealed', ticketId: Number(id) });
  reply.send({ success: true });
});

fastify.put('/api/session/:shortId/ticket/:id/estimate', async (request, reply) => {
  const { shortId, id } = request.params as { shortId: string; id: string };
  const { estimate } = request.body as { estimate: string };
  
  db.query('UPDATE tickets SET estimate = ? WHERE id = ?').run(estimate, id);
  broadcast(shortId, {
    type: 'ticket:updated',
    ticketId: Number(id),
    estimate,
  });
  reply.send({ success: true });
});

fastify.put('/api/session/:shortId/current-ticket', async (request, reply) => {
  const { shortId } = request.params as { shortId: string };
  const { ticketIndex } = request.body as { ticketIndex: number };
  broadcast(shortId, { type: 'current-ticket:changed', ticketIndex });
  reply.send({ success: true });
});

fastify.delete('/api/session/:shortId/ticket/:id', async (request, reply) => {
  const { shortId, id } = request.params as { shortId: string; id: string };
  db.query('DELETE FROM tickets WHERE id = ?').run(id);
  broadcast(shortId, { type: 'ticket:deleted', ticketId: Number(id) });
  reply.send({ success: true });
});

fastify.get('/api/session/:shortId/attendees', async (request, reply) => {
  const { shortId } = request.params as { shortId: string };
  const counts = attendeeConnectionCount.get(shortId);
  const attendees = counts ? Array.from(counts.entries()).map(([id, count]) => ({ id, connectionCount: count })) : [];
  reply.send({ attendees });
});

fastify.get('/api/session/:shortId/ticket/:id/votes', async (request, reply) => {
  const { shortId, id } = request.params as { shortId: string; id: string };
  const { requestingAttendeeId } = request.query as { requestingAttendeeId?: string };
  const votes = ticketVotes.get(shortId)?.get(Number(id));
  const revealed = ticketRevealed.get(shortId)?.get(Number(id)) || false;
  const counts = attendeeConnectionCount.get(shortId);
  const attendeeList = counts ? Array.from(counts.keys()) : [];
  const voteStatus = attendeeList.map((attendeeId) => ({
    attendeeId,
    hasVoted: votes?.has(attendeeId) || false,
    vote: revealed || attendeeId === requestingAttendeeId ? votes?.get(attendeeId) || null : null,
  }));
  reply.send({ votes: voteStatus, revealed });
});

fastify.register(async (fastify) => {
  fastify.get('/ws/:shortId', { websocket: true }, (socket, request) => {
    const { shortId } = request.params as { shortId: string };
    const { existingAttendeeId } = request.query as { existingAttendeeId?: string };
    const attendeeId = existingAttendeeId || randomUUID();
    
    if (!sessionClients.has(shortId)) {
      sessionClients.set(shortId, new Set());
    }
    if (!sessionAttendees.has(shortId)) {
      sessionAttendees.set(shortId, new Map());
    }
    if (!attendeeConnectionCount.has(shortId)) {
      attendeeConnectionCount.set(shortId, new Map());
    }
    
    sessionClients.get(shortId)?.add(socket);
    sessionAttendees.get(shortId)?.set(socket, attendeeId);
    
    const counts = attendeeConnectionCount.get(shortId)!;
    counts.set(attendeeId, (counts.get(attendeeId) || 0) + 1);
    
    socket.send(JSON.stringify({ type: 'attendee:id', attendeeId }));
    broadcast(shortId, { type: 'attendees:updated' });
    
    socket.on('close', () => {
      sessionClients.get(shortId)?.delete(socket);
      sessionAttendees.get(shortId)?.delete(socket);
      
      const counts = attendeeConnectionCount.get(shortId);
      if (counts) {
        const currentCount = counts.get(attendeeId) || 0;
        if (currentCount <= 1) {
          counts.delete(attendeeId);
          const votes = ticketVotes.get(shortId);
          if (votes) {
            for (const [ticketId, voteMap] of votes) {
              if (voteMap.delete(attendeeId)) {
                broadcast(shortId, { type: 'votes:updated', ticketId });
              }
            }
          }
        } else {
          counts.set(attendeeId, currentCount - 1);
        }
      }
      
      broadcast(shortId, { type: 'attendees:updated' });
    });
  });
});

const reset = '\x1b[0m';
const cyan = '\x1b[36m';
const _dim = '\x1b[2m%s';
const bright = '\x1b[1m';

const start = async () => {
  try {
    // without manually listening for interrupts, this hangs in docker.
    process.on('SIGINT', async () => {
      await fastify.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await fastify.close();
      process.exit(0);
    });

    const listenText = `Bun serving at ${[cyan, 'http://localhost:', bright, config.serverPort, reset].join('')}`;
    await fastify.listen({
      host: '0.0.0.0', // explicitly bind to all interfaces
      port: config.serverPort,
      listenTextResolver: () => listenText,
    });
    console.debug(listenText);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
