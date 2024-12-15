import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { Server, IncomingMessage, ServerResponse } from "http";
import Stripe from "stripe";
import { configs, ConfigType } from "../configs";
import { randomUUID } from "crypto";

const config: ConfigType = configs[process.env.NODE_ENV || "development"];
const appDomain = config.appBasename; // "http://localhost:4000" or "https://seanscards.com"

const stripe = new Stripe(
  "sk_test_51QVX2JBsGhYF8YEWi3iM9PCLwFMG2AMbKx1eq6L4mPMp6TB62S9tve5NypbQmeiTTJ9epEAJhaO01lTLOZI4Huxy0009gNLP2Z"
);

const fastify = Fastify<Server, IncomingMessage, ServerResponse>({
  logger: { level: "error" },
});

fastify.register(cors);
fastify.register(formbody);
fastify.register(cookie, {
  secret: "super", // for cookies signature
  hook: "onRequest", // set to false to disable cookie autoparsing or set autoparsing on any of the following hooks: 'onRequest', 'preParsing', 'preHandler', 'preValidation'. default: 'onRequest'
  parseOptions: {}, // options for parsing cookies
});
fastify.register(jwt, { secret: "super" });

fastify.post("/api/create-checkout-session", async (request, reply) => {
  console.debug("create-checkout-session", request.headers);
  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded",
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

  reply.send({ clientSecret: session.client_secret });
});

fastify.get("/api/session-status", async (request, reply) => {
  const session = await stripe.checkout.sessions.retrieve(
    (request.query as unknown as any).session_id
  );

  reply.send({
    status: session.status,
    customer_email: session.customer_details?.email,
  });
});

fastify.get("/api/session-token", async (request, reply) => {
  // BE does not care nor store sessions. this is an FE responsibility
  reply.send(randomUUID());
});

type FormShape = {
  message: string;
  address: string;
  email: string;
  selectedCardDesign: string;
};

fastify.post("/api/update-session-fields", async (request, reply) => {
  const { sessionToken, ...fields } = request.body as FormShape & {
    sessionToken: string;
  };
  // TODO sql update session id sessionToken with last updated fields
  // concatenate message to 1120 chars
  // concatenate address to 1120 chars
  // concatenate email to 255 chars
  reply.send({ status: "ok" });
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
