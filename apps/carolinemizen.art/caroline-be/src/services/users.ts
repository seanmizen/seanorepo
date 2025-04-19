import { User } from "../../../shared/types";
import { hashPassword } from "../utils/hash-password";
import { openDbConnection } from "./db";
import { CreateUserDto } from "../types";

const getUser: (id: number) => Promise<User> = async (id: number) => {
  const db = await openDbConnection();
  return new Promise((resolve, reject) => {
    db.all<User>(`SELECT * FROM users WHERE id = ${id}`, (err, rows) => {
      if (err) {
        console.error(err);
        db.close();
        reject(err);
      } else {
        db.close();
        resolve(rows[0]);
      }
    });
  });
};

const getUsers: (limit?: number) => Promise<User[]> = async (
  limit?: number
) => {
  const db = await openDbConnection();
  return new Promise((resolve, reject) => {
    db.all<User>(`SELECT * FROM users LIMIT ${limit}`, (err, rows) => {
      if (err) {
        console.error(err);
        db.close();
        reject(err);
      } else {
        db.close();
        resolve(rows);
      }
    });
  });
};

const createUser: (user: CreateUserDto) => Promise<User> = async (
  user: CreateUserDto
) => {
  const { hash, salt, iterations } = hashPassword(user.password);
  const db = await openDbConnection();
  const role = user.role || "user";
  return new Promise((resolve, reject) => {
    db.all<User>(
      `INSERT INTO users (email, password_hash, password_salt, salt_iterations, role) VALUES (?, ?, ?, ?, ?)`,
      [user.email, hash, salt, iterations, role],
      (err, rows) => {
        if (err) {
          console.error(err);
          db.close();
          reject(err);
        } else {
          db.close();
          resolve(rows[0]);
        }
      }
    );
  });
};

export { getUser, getUsers, createUser };
