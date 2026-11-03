import type { HealthResponse } from '@shared/types';
import type { FastifyInstance } from 'fastify';
import { renderPage } from '../render';
import { getHealth } from './api/health';

/** The home page. A placeholder that shows the health result. */
export const HomePage = ({ health }: { health: HealthResponse }) => (
  <main>
    <h1>crm</h1>
    <p>
      <code>GET /api/health</code>: <code>{JSON.stringify(health)}</code>
    </p>
  </main>
);

/** `GET /` */
export const homeRoute = (app: FastifyInstance) => {
  app.get('/', async (_request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(renderPage('crm', <HomePage health={getHealth()} />)),
  );
};
