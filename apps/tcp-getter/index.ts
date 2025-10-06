import Fastify from "fastify";
import nodemailer from "nodemailer";
import fastifyCors from "@fastify/cors";

const SITE_BASE_URL = process.env.SITE_BASE_URL;
const SSH_USERNAME = process.env.SSH_USERNAME;
const PORT = Number(process.env.PORT);
const MAIL_USERNAME = process.env.MAIL_USERNAME;
const MAIL_PASSWORD = process.env.MAIL_PASSWORD;
const NGROK_API_URL =
  process.env.NGROK_API_URL || "http://127.0.0.1:4040/api/tunnels";
const EMAIL_WHITELIST =
  process.env.EMAIL_WHITELIST?.split(",").map((e) => e.trim()) || [];
const MOCK_TCP_TUNNEL = process.env.MOCK_TCP_TUNNEL === "true";

function validateEnvVars() {
  const required = {
    SITE_BASE_URL,
    SSH_USERNAME,
    PORT,
    MAIL_USERNAME,
    MAIL_PASSWORD,
    EMAIL_WHITELIST: EMAIL_WHITELIST.length > 0,
  };

  const missing = Object.entries(required)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

interface NgrokTunnel {
  proto: string;
  public_url: string;
}

interface NgrokResponse {
  tunnels: NgrokTunnel[];
}

const getTcpTunnelUrl = async (): Promise<{ host: string; port: string }> => {
  if (MOCK_TCP_TUNNEL) return { host: "6.tcp.eu.ngrok.io", port: "19931" };
  try {
    const response = await fetch(NGROK_API_URL);
    const data = (await response.json()) as NgrokResponse;

    const tcpTunnel = data.tunnels.find((tunnel) => tunnel.proto === "tcp");

    if (!tcpTunnel) {
      throw new Error("No TCP tunnel found");
    }

    // Parse tcp://6.tcp.eu.ngrok.io:13075
    const url = tcpTunnel.public_url.replace("tcp://", "");
    const [host, port] = url.split(":");

    return { host, port };
  } catch (error) {
    console.error("Failed to fetch NGROK TCP tunnel:", error);
    throw new Error("Could not determine TCP tunnel address");
  }
};

const isEmailWhitelisted = (email: string): boolean => {
  if (EMAIL_WHITELIST.length === 0) {
    console.warn("No email whitelist configured - all emails will be rejected");
    return false;
  }
  return EMAIL_WHITELIST.includes(email);
};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: MAIL_USERNAME,
    pass: MAIL_PASSWORD,
  },
});

async function sendSSHEmail(
  email: string,
  options: { isStartup?: boolean } = {}
) {
  const { host, port } = await getTcpTunnelUrl();
  const sshCommand = `ssh ${SSH_USERNAME}@${host} -p ${port}`;
  const timestamp = new Date().toLocaleString();

  const subject = options.isStartup
    ? "tcp-getter Started - SSH Connection Details"
    : "SSH Connection Details";

  const textPrefix = options.isStartup
    ? "tcp-getter has started successfully.\n\n"
    : "";
  const htmlPrefix = options.isStartup
    ? "<p><strong>tcp-getter has started successfully.</strong></p>\n  "
    : "";

  const timeLabel = options.isStartup ? "Startup time" : "Message sent at";

  await transporter.sendMail({
    to: email,
    from: MAIL_USERNAME,
    subject,
    text: `${textPrefix}Your SSH connection command:\n\n${sshCommand}\n\nHost: ${host}\nPort: ${port}`,
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body>
  ${htmlPrefix}<p>Your SSH connection command:</p>
  <pre style="background-color: #f4f4f4; padding: 10px; border-radius: 5px; font-family: monospace;">${sshCommand}</pre>
  <p><strong>Host:</strong> ${host}<br><strong>Port:</strong> ${port}</p>
  <p>${timeLabel}: ${timestamp}</p>
</body>
</html>`,
  });
}

async function sendStartupEmail() {
  try {
    await sendSSHEmail(EMAIL_WHITELIST[0], { isStartup: true });
    console.log(`Startup email sent to ${EMAIL_WHITELIST[0]}`);
  } catch (error) {
    console.error("Failed to send startup email:", error);
  }
}

async function start() {
  validateEnvVars();

  const fastify = Fastify({
    logger: { level: "error" },
  });

  await fastify.register(fastifyCors, {
    origin: SITE_BASE_URL || true,
    credentials: true,
  });

  fastify.get("/tcp/ping", async (req, res) => {
    res.send({ ok: true, timestamp: Date.now() });
  });

  fastify.post("/tcp/send-ssh", async (req, res) => {
    const { email } = req.body as { email?: string };

    if (!email) {
      return res.status(400).send({ error: "Email is required" });
    }

    // Check whitelist
    if (!isEmailWhitelisted(email)) {
      console.log(`Email not whitelisted: ${email}`);
      // Return success to avoid leaking whitelist information
      return res.send({ ok: true });
    }

    try {
      await sendSSHEmail(email);
      console.log(`SSH details sent to whitelisted email: ${email}`);
      res.send({ ok: true });
    } catch (error) {
      console.error("Error sending SSH email:", error);
      return res.status(500).send({
        error: "Failed to send SSH details",
        message: (error as Error)?.message,
      });
    }
  });

  // without manually listening for interrupts, this hangs in docker.
  process.on("SIGINT", async () => {
    await fastify.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await fastify.close();
    process.exit(0);
  });

  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`tcp-getter running on port ${PORT}`);

  // Send startup email with connection details
  await sendStartupEmail();
}

start();
