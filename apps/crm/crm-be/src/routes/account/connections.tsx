import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../../auth';
import {
  addToken,
  type ConnectionRow,
  listConnections,
  MCP_URL,
  revokeConnection,
} from '../../oauth';
import { formText } from '../../org';
import { type PageParts, renderPage } from '../../render';
import { Box } from '../../ui/Box';
import { Device } from '../../ui/Device';
import { Field } from '../../ui/Field';
import { Key } from '../../ui/Key';
import { Lcd } from '../../ui/Lcd';
import { Module } from '../../ui/Module';
import { RecordTable } from '../../ui/RecordTable';
import { When } from '../../ui/When';

/** The type of a connection, as the page shows it. */
const KIND_TEXT: Record<ConnectionRow['kind'], string> = {
  token: 'Token',
  oauth: 'App sign-in',
};

/** The longest name of a token. */
const NAME_MAX = 100;

/**
 * The connections page: the MCP connections of the admin (`oauth.ts`).
 * The device adds a personal access token, for Claude Code. After an add,
 * the New token box shows the token and the `claude mcp add` command one
 * time: the database keeps only the hash. The Connections box lists each
 * token and each app sign-in (OAuth, for the Claude apps), with a small
 * revoke key for each one. The Claude box tells how to connect each app.
 */
export const connectionsPage = ({
  connections,
  token,
  error,
}: {
  connections: ConnectionRow[];
  token?: string;
  error?: string;
}): PageParts => ({
  title: 'Connections',
  device: (
    <Device>
      <Lcd alert={error} />
      <form method="post" action="/account/connections">
        <Module label="Add a token">
          <div className="pair">
            <Field label="Name">
              <input
                name="name"
                required
                maxLength={NAME_MAX}
                autoComplete="off"
                placeholder="Claude Code"
              />
            </Field>
            <Key>Add</Key>
          </div>
        </Module>
      </form>
    </Device>
  ),
  boxes: (
    <>
      {token && (
        <Box title="New token">
          <p>Copy the token now. This page shows it one time.</p>
          <p>
            <code>{token}</code>
          </p>
          <p>Claude Code:</p>
          <p>
            <code>{`claude mcp add --transport http crm ${MCP_URL} --header "Authorization: Bearer ${token}"`}</code>
          </p>
        </Box>
      )}
      <Box title="Connections">
        {connections.length === 0 ? (
          <p>No connections.</p>
        ) : (
          <form method="post" action="/account/connections">
            <RecordTable
              head={['Name', 'Type', 'Added', 'Last used', 'Action']}
              rowHeader
              rows={connections.map((connection) => ({
                key: connection.id,
                cells: [
                  connection.name,
                  KIND_TEXT[connection.kind],
                  <When key="added" value={connection.created_at} />,
                  connection.last_used_at ? (
                    <When key="used" value={connection.last_used_at} />
                  ) : (
                    'Never'
                  ),
                  <Key key="revoke" name="revoke" value={connection.id}>
                    Revoke
                  </Key>,
                ],
              }))}
            />
          </form>
        )}
      </Box>
      <Box title="Claude">
        <p>
          Claude app: in Settings, Connectors, add a custom connector with the
          URL <code>{MCP_URL}</code>. Then tap Allow on this site.
        </p>
        <p>Claude Code: add a token, then run the command that shows.</p>
      </Box>
    </>
  ),
});

/** Render the page for the admin, with a new `token` or an `error`. */
const sendPage = (
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  { token, error }: { token?: string; error?: string } = {},
) =>
  reply
    .code(error ? 400 : 200)
    .header('cache-control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(
      renderPage(
        request,
        connectionsPage({
          connections: listConnections(db, (request.auth as Auth).personId),
          token,
          error,
        }),
      ),
    );

/**
 * `GET /account/connections` and `POST /account/connections`: an admin
 * route. A post with `name` adds a token. A post with `revoke=<id>`
 * revokes a connection of the admin.
 */
export const accountConnectionsRoute = (app: FastifyInstance, db: Database) => {
  app.get(
    '/account/connections',
    { config: { admin: true } },
    async (request, reply) => sendPage(db, request, reply),
  );

  app.post<{ Body: { name?: string; revoke?: string } }>(
    '/account/connections',
    { config: { admin: true } },
    async (request, reply) => {
      const auth = request.auth as Auth;
      const revoke = formText(request.body?.revoke);
      if (revoke) {
        revokeConnection(db, auth.personId, revoke);
        return reply.redirect('/account/connections', 303);
      }
      const name = formText(request.body?.name);
      if (!name) {
        return sendPage(db, request, reply, {
          error: 'Type a name for the token.',
        });
      }
      if (name.length > NAME_MAX) {
        return sendPage(db, request, reply, {
          error: `The name can have at most ${NAME_MAX} characters.`,
        });
      }
      const token = addToken(db, auth.personId, name);
      return sendPage(db, request, reply, { token });
    },
  );
};
