import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { Server, IncomingMessage, ServerResponse } from "http";
import { routes } from "./src/controllers";

// const fastify = Fastify({ logger: { level: 'error' } });
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

fastify.register(routes);

const reset = "\x1b[0m";
const cyan = "\x1b[36m";
const dim = "\x1b[2m%s";
const bright = "\x1b[1m";

const start = async () => {
  const port = 5000;
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
