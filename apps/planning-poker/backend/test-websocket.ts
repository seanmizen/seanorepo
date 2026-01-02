/**
 * WebSocket Test Tool for Planning Poker
 *
 * This script connects to a Planning Poker game session's WebSocket
 * and sends test messages to trigger debug snackbars in the frontend.
 *
 * Usage:
 *   bun test-websocket.ts <shortId> [options]
 *
 * Examples:
 *   bun test-websocket.ts abc1                    # Connect and listen
 *   bun test-websocket.ts abc1 --send             # Send a refresh message
 *   bun test-websocket.ts abc1 --spam 5           # Send 5 rapid messages
 *   bun test-websocket.ts abc1 --version-jump 10  # Skip 10 versions (test missed updates)
 *   bun test-websocket.ts abc1 --ticket "Fix bug" # Send ticket-changed message
 *
 * Environment:
 *   WS_PORT=4031  # Default WebSocket port (can be overridden)
 */

const WS_PORT = process.env.WS_PORT || '4031';
const WS_HOST = process.env.WS_HOST || 'localhost';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(color: string, prefix: string, message: string) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(
    `${colors.gray}[${timestamp}]${colors.reset} ${color}${prefix}${colors.reset} ${message}`,
  );
}

interface WsMessage {
  type: 'refresh' | 'ticket-changed' | 'attendee:id' | 'kicked';
  version?: number;
  changedBy?: string;
  ticketTitle?: string;
  attendeeId?: string;
}

class PlanningPokerWsTest {
  private ws: WebSocket | null = null;
  private currentVersion = 0;
  private wsUrl: string;

  constructor(shortId: string) {
    this.wsUrl = `ws://${WS_HOST}:${WS_PORT}/ws/${shortId}`;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      log(colors.cyan, '[CONNECT]', `Connecting to ${this.wsUrl}`);

      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        log(colors.green, '[OPEN]', 'WebSocket connection established');
        resolve();
      };

      this.ws.onmessage = (event) => {
        const message: WsMessage = JSON.parse(event.data);
        this.currentVersion = message.version || this.currentVersion;

        let details = `type=${message.type}`;
        if (message.version) details += `, version=${message.version}`;
        if (message.changedBy) details += `, changedBy=${message.changedBy}`;
        if (message.ticketTitle)
          details += `, ticketTitle="${message.ticketTitle}"`;
        if (message.attendeeId) details += `, attendeeId=${message.attendeeId}`;

        log(colors.green, '[RECV]', details);
      };

      this.ws.onerror = (error) => {
        log(colors.red, '[ERROR]', `WebSocket error: ${error}`);
        reject(error);
      };

      this.ws.onclose = (event) => {
        log(
          colors.yellow,
          '[CLOSE]',
          `Connection closed (code: ${event.code}, reason: ${event.reason || 'none'})`,
        );
      };
    });
  }

  send(message: WsMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log(colors.red, '[ERROR]', 'WebSocket is not connected');
      return;
    }

    const data = JSON.stringify(message);
    this.ws.send(data);

    let details = `type=${message.type}`;
    if (message.version) details += `, version=${message.version}`;
    if (message.changedBy) details += `, changedBy=${message.changedBy}`;
    if (message.ticketTitle)
      details += `, ticketTitle="${message.ticketTitle}"`;

    log(colors.blue, '[SEND]', details);
  }

  sendRefresh(version?: number) {
    const v = version ?? this.currentVersion + 1;
    this.currentVersion = v;
    this.send({ type: 'refresh', version: v });
  }

  sendTicketChanged(
    ticketTitle: string,
    changedBy = 'test-tool',
    version?: number,
  ) {
    const v = version ?? this.currentVersion + 1;
    this.currentVersion = v;
    this.send({
      type: 'ticket-changed',
      version: v,
      ticketTitle,
      changedBy,
    });
  }

  sendVersionJump(jumpCount: number) {
    const newVersion = this.currentVersion + jumpCount;
    log(
      colors.yellow,
      '[JUMP]',
      `Skipping from v${this.currentVersion} to v${newVersion} (${jumpCount - 1} missed updates)`,
    );
    this.sendRefresh(newVersion);
  }

  async spam(count: number, delay = 100) {
    log(
      colors.yellow,
      '[SPAM]',
      `Sending ${count} rapid messages with ${delay}ms delay`,
    );
    for (let i = 0; i < count; i++) {
      this.sendRefresh();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Parse CLI arguments
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
${colors.cyan}WebSocket Test Tool for Planning Poker${colors.reset}

${colors.yellow}Usage:${colors.reset}
  bun test-websocket.ts <shortId> [options]

${colors.yellow}Arguments:${colors.reset}
  shortId                 Game session ID (required)

${colors.yellow}Options:${colors.reset}
  --send                  Send a single refresh message
  --spam <count>          Send multiple rapid refresh messages
  --version-jump <count>  Skip versions to test missed update detection
  --ticket <title>        Send a ticket-changed message
  --delay <ms>            Delay between spam messages (default: 100ms)
  --help, -h              Show this help message

${colors.yellow}Examples:${colors.reset}
  bun test-websocket.ts abc1
  bun test-websocket.ts abc1 --send
  bun test-websocket.ts abc1 --spam 5
  bun test-websocket.ts abc1 --version-jump 10
  bun test-websocket.ts abc1 --ticket "Fix login bug"

${colors.yellow}Environment Variables:${colors.reset}
  WS_PORT=${WS_PORT}    # WebSocket port
  WS_HOST=${WS_HOST}   # WebSocket host
    `);
    process.exit(0);
  }

  const shortId = args[0];
  const client = new PlanningPokerWsTest(shortId);

  try {
    await client.connect();

    // Parse options
    let i = 1;
    while (i < args.length) {
      const arg = args[i];

      if (arg === '--send') {
        client.sendRefresh();
        i++;
      } else if (arg === '--spam') {
        const count = Number.parseInt(args[i + 1], 10);
        const delay =
          args[i + 2] === '--delay' ? Number.parseInt(args[i + 3], 10) : 100;
        await client.spam(count, delay);
        i += args[i + 2] === '--delay' ? 4 : 2;
      } else if (arg === '--version-jump') {
        const jump = Number.parseInt(args[i + 1], 10);
        client.sendVersionJump(jump);
        i += 2;
      } else if (arg === '--ticket') {
        const title = args[i + 1];
        client.sendTicketChanged(title);
        i += 2;
      } else {
        i++;
      }
    }

    // If no action flags were provided, just listen
    const hasActions = args.some((arg) =>
      ['--send', '--spam', '--version-jump', '--ticket'].includes(arg),
    );

    if (!hasActions) {
      log(
        colors.cyan,
        '[LISTEN]',
        'Listening for messages... Press Ctrl+C to exit',
      );
    } else {
      // Wait a bit for responses, then exit
      log(colors.gray, '[WAIT]', 'Waiting for responses...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      log(colors.gray, '[DONE]', 'Test complete');
      client.close();
      process.exit(0);
    }

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      log(colors.yellow, '[EXIT]', 'Shutting down...');
      client.close();
      process.exit(0);
    });
  } catch (error) {
    log(colors.red, '[ERROR]', `Failed to connect: ${error}`);
    process.exit(1);
  }
}

main();
