import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { userService } from "../services";
import { CreateUserDto } from "src/server/types";

const createUser = async (request: FastifyRequest, reply: FastifyReply) => {
  const user = request.body as CreateUserDto; // TODO this but properly
  try {
    await userService.createUser(user);
    reply.send({ message: "User created" });
  } catch (err) {
    reply.status(500).send(err);
  }
};

const getUsers = async (_request: FastifyRequest, reply: FastifyReply) => {
  const users = await userService.getUsers();
  reply.send(users);
};

const getUser = async (request: FastifyRequest, reply: FastifyReply) => {
  const id = request?.params?.id || 0;
  const user = await userService.getUser(id);
  reply.send(user);
};

const routes = async (
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
) => {
  fastify.post("/", createUser);
  fastify.get("/", getUsers);
  fastify.get("/:id", getUser);
  // fastify.put("/:id", updateUser);
  // fastify.delete("/:id", deleteUser);
};

export { routes };
