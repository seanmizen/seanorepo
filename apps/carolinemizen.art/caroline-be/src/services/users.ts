import type { User } from '../../../shared/types';
import type { CreateUserDto } from '../types';
import { hashPassword } from '../utils/hash-password';
import { openDbConnection } from './db';

const getUser: (id: number) => Promise<User> = async (id: number) => {
  const db = await openDbConnection();
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User;
    db.close();
    return user;
  } catch (err) {
    console.error(err);
    db.close();
    throw err;
  }
};

const getUsers: (limit?: number) => Promise<User[]> = async (
  limit?: number,
) => {
  const db = await openDbConnection();
  try {
    const users = limit
      ? (db.prepare('SELECT * FROM users LIMIT ?').all(limit) as User[])
      : (db.prepare('SELECT * FROM users').all() as User[]);
    db.close();
    return users;
  } catch (err) {
    console.error(err);
    db.close();
    throw err;
  }
};

const createUser: (user: CreateUserDto) => Promise<User> = async (
  user: CreateUserDto,
) => {
  const { hash, salt, iterations } = hashPassword(user.password);
  const db = await openDbConnection();
  const role = user.role || 'user';
  try {
    const result = db
      .prepare(
        'INSERT INTO users (email, password_hash, password_salt, salt_iterations, role) VALUES (?, ?, ?, ?, ?)',
      )
      .run(user.email, hash, salt, iterations, role);
    const createdUser = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(result.lastInsertRowid) as User;
    db.close();
    return createdUser;
  } catch (err) {
    console.error(err);
    db.close();
    throw err;
  }
};

export { getUser, getUsers, createUser };
