import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { randomUUID } from "crypto";
import { IncomingMessage, Server, ServerResponse } from "http";
import Stripe from "stripe";
import { db } from "./db";
import { configs, ConfigType } from "../configs";

// until stated otherwise...
const env = process.env.NODE_ENV || "development";
const config: ConfigType = configs[env];
const { appDomain } = config;

const stripe = new Stripe(
  "sk_test_51QVX2JBsGhYF8YEWi3iM9PCLwFMG2AMbKx1eq6L4mPMp6TB62S9tve5NypbQmeiTTJ9epEAJhaO01lTLOZI4Huxy0009gNLP2Z"
);

const fastify = Fastify<Server, IncomingMessage, ServerResponse>({
  logger: { level: "error" },
});

fastify.register(cors);
fastify.register(formbody);
fastify.register(cookie, { secret: "super", hook: "onRequest" });
fastify.register(jwt, { secret: "super" });

fastify.get("/api", async (request, reply) => {
  return { hello: "world" };
});

fastify.post("/api/create-checkout-session", async (request, reply) => {
  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded",
    submit_type: "pay",
    line_items: [
      {
        price: config.productCode,
        quantity: 1,
      },
    ],
    mode: "payment",
    return_url: `${appDomain}/return?session_id={CHECKOUT_SESSION_ID}`,
    automatic_tax: { enabled: true },
  });
  reply.send({ clientSecret: session.client_secret, sessionId: session.id });
});

fastify.get("/api/session-status", async (request, reply) => {
  const sessionId = (request.query as { session_id?: string }).session_id;
  if (!sessionId) {
    reply.status(400).send({ error: "Missing session_id" });
    return;
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  // update DB with stripe status and stripe email
  // stripeStatus TEXT,
  // stripeCustomerEmail TEXT,

  try {
    const stmt = db.prepare(`
      UPDATE sessions
      SET stripeStatus = ?,
          stripeCustomerEmail = ?
      WHERE stripeSessionId = ?
    `);

    const result = stmt.run(
      session.status,
      session.customer_details?.email || "",
      sessionId
    );
  } catch (error) {
    console.error("Database error:", error);
    console.error("session:", session, "sessionId:", sessionId);
    reply.status(500).send({ error: "Database error" });
  }

  reply.send({
    status: session.status,
    customer_email: session.customer_details?.email,
  });
});

fastify.get("/api/session-token", async (request, reply) => {
  // BE does not care nor store sessions. this is an FE responsibility
  const token = randomUUID();
  reply.send(token);
});

type FormShape = {
  message: string;
  address: string;
  email: string;
  selectedCardDesign: string;
};

fastify.post("/api/update-session-fields", async (request, reply) => {
  const {
    sessionToken,
    stripeSessionId = "",
    ...fields
  } = request.body as FormShape & {
    // sessionToken is ours
    sessionToken: string;
    // stripeSessionId is stripe's
    stripeSessionId?: string;
  };
  if (!sessionToken) {
    reply.status(400).send({ error: "Missing sessionToken" });
    return;
  }

  // Sanitize inputs
  const safeMessage = fields.message.slice(0, 1120);
  const safeAddress = fields.address.slice(0, 1120);
  const safeEmail = fields.email.slice(0, 255);
  const safeDesign = fields.selectedCardDesign.slice(0, 255);
  const safeStripeSessionId = stripeSessionId?.slice(0, 255);
  const safeSessionToken = sessionToken.slice(0, 255);

  try {
    const stmt = db.prepare(`
      INSERT INTO sessions (
        sessionToken,
        message,
        address,
        email,
        selectedCardDesign,
        stripeSessionId
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(sessionToken) DO UPDATE SET
        message = excluded.message,
        address = excluded.address,
        email = excluded.email,
        selectedCardDesign = excluded.selectedCardDesign,
        stripeSessionId = excluded.stripeSessionId
    `);

    const result = stmt.run(
      safeSessionToken,
      safeMessage,
      safeAddress,
      safeEmail,
      safeDesign,
      safeStripeSessionId
    );

    reply.send({ status: "ok" });
  } catch (error) {
    console.error("Database error:", error);
    reply.status(500).send({ error: "Database error" });
  }
});

const reset = "\x1b[0m";
const cyan = "\x1b[36m";
const dim = "\x1b[2m%s";
const bright = "\x1b[1m";

const start = async () => {
  try {
    await fastify.listen({
      port: config.serverPort,
    });
    console.debug(
      "Bun serving at",
      [cyan, "http://localhost:", bright, config.serverPort, reset].join("")
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
