import type { HealthResponse } from '@shared/types';
import type { FastifyInstance } from 'fastify';
import { renderPage, type Theme, themeOf } from '../render';
import { Field } from '../ui/Field';
import { Key } from '../ui/Key';
import { Led } from '../ui/Led';
import { Panel } from '../ui/Panel';
import { getHealth } from './api/health';

/**
 * The home page. A placeholder that shows the health result, and a form that
 * sets the theme.
 */
export const HomePage = ({
  health,
  theme,
}: {
  health: HealthResponse;
  theme: Theme;
}) => (
  <>
    <Panel label="Status">
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th>Response</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              <code>GET /api/health</code>
            </th>
            <td>
              <code>{JSON.stringify(health)}</code>
            </td>
            <td>
              <Led on={health.ok}>{health.ok ? 'OK' : 'Down'}</Led>
            </td>
          </tr>
        </tbody>
      </table>
    </Panel>
    <Panel label="Display">
      <form method="get" action="/">
        <Field label="Theme">
          <select name="theme" defaultValue={theme}>
            <option value="pixel-3">Pixel-3</option>
            <option value="bare">Bare</option>
          </select>
        </Field>{' '}
        <Key>Apply</Key>
      </form>
    </Panel>
  </>
);

/** `GET /` */
export const homeRoute = (app: FastifyInstance) => {
  app.get('/', async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(
        renderPage(
          'Home',
          <HomePage health={getHealth()} theme={themeOf(request)} />,
          request,
        ),
      ),
  );
};
