import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { Server, IncomingMessage, ServerResponse } from "http";
import Stripe from "stripe";
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

// fastify.register(routes);
fastify.get("/", async (request, reply) => {
  console.debug("we hello-worlding", request.headers);
  return { hello: "world" };
});

const YOUR_DOMAIN = "http://localhost:3000";
fastify.post("/create-checkout-session", async (request, reply) => {
  console.debug("create-checkout-session", request.headers);
  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded",
    line_items: [
      {
        // "prod_ROSpFjN63ZsvCY",
        price: "price_1QVfu2BsGhYF8YEWBId3mVNi",
        quantity: 1,
      },
    ],
    mode: "payment",
    return_url: `${YOUR_DOMAIN}/return?session_id={CHECKOUT_SESSION_ID}`,
    automatic_tax: { enabled: true },
  });

  reply.send({ clientSecret: session.client_secret });
});

fastify.get("/session-status", async (request, reply) => {
  const session = await stripe.checkout.sessions.retrieve(
    (request.query as unknown as any).session_id
  );

  reply.send({
    status: session.status,
    customer_email: session.customer_details?.email,
  });
});

const reset = "\x1b[0m";
const cyan = "\x1b[36m";
const dim = "\x1b[2m%s";
const bright = "\x1b[1m";

const start = async () => {
  const port = 4242;
  try {
    await fastify.listen({
      port,
    });
    console.debug(
      "Bun serving at",
      [cyan, "http://localhost:", bright, port, reset].join("")
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
