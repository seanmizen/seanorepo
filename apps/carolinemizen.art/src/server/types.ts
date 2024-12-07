import { User } from "src/shared/types";

export type CreateUserDto = Omit<User, "id" | "dateCreated" | "role"> & {
  role?: string;
};
