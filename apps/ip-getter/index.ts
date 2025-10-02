import Fastify from "fastify";
import nodemailer from "nodemailer";
import crypto from "crypto";
import fastifyCookie from "@fastify/cookie";

const EMAIL = "you@example.com"; // your own email
const TOKEN_SECRET = "some-long-secret";
const TOKEN_TIMEOUT_MS = 10 * 60 * 1000; // 10 min
const AUTH_COOKIE = "ip_auth";

const pendingTokens = new Map<string, number>();

const transporter = nodemailer.createTransport({
  host: "smtp.yourmailserver.com",
  port: 587,
  secure: false,
  auth: {
    user: "smtpuser",
    pass: "smtppass",
  },
});

const fastify = Fastify();
fastify.register(fastifyCookie);

const makeToken = () => crypto.randomBytes(32).toString("hex");

const isAuthenticated = (req: any) => req.cookies[AUTH_COOKIE] === TOKEN_SECRET;

fastify.post("/auth-request", async (req, res) => {
  const token = makeToken();
  const expiry = Date.now() + TOKEN_TIMEOUT_MS;
  pendingTokens.set(token, expiry);

  const link = `https://ip-getter.seanmizen.com/auth-verify?token=${token}`;
  await transporter.sendMail({
    to: EMAIL,
    from: "noreply@ip-getter.seanmizen.com",
    subject: "Login to IP Getter",
    text: `Click to log in:\n\n${link}`,
  });

  res.send({ ok: true });
});

fastify.get("/auth-verify", async (req, res) => {
  const { token } = req.query as { token?: string };
  const expiry = token && pendingTokens.get(token);

  if (!token || !expiry || Date.now() > expiry) {
    return res.status(401).send("Invalid or expired token.");
  }

  pendingTokens.delete(token);
  res.setCookie(AUTH_COOKIE, TOKEN_SECRET, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60, // 1 hour
  });

  res.send("Logged in. You can now access /ip.");
});

fastify.get("/ip", async (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).send("Unauthorized");

  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  res.send({ ip });
});

fastify.listen({ port: 3000 }, () => {
  console.log("ip-getter running on port 3000");
});
