import { Request, Response } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { User } from '@shared/types';

const dataPath = join(import.meta.dir, '../..', 'data', 'users.json');

// on server start, create file if it doesn't exist
writeFile(dataPath, JSON.stringify([]), { flag: 'wx' }).catch(() => {});

const readJsonFile: () => Promise<User[]> = async () => {
  try {
    const data = await readFile(dataPath, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    throw new Error('Unable to read from file');
  }
};

const writeJsonFile = async (data: User[]) => {
  try {
    await writeFile(dataPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    throw new Error('Unable to write to file');
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const users: User[] = await readJsonFile();
    const highestId = users.reduce((acc, curr) => (curr.id > acc ? curr.id : acc), 0);
    const newUser: User = { id: highestId + 1, dateCreated: Date.now(), ...req.body };
    users.push(newUser);
    await writeJsonFile(users);
    res.status(201).json(newUser);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const users = await readJsonFile();
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const users = await readJsonFile();
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateUserById = async (req: Request, res: Response) => {
  try {
    const users = await readJsonFile();
    const index = users.findIndex(u => u.id === parseInt(req.params.id));
    if (index === -1) {
      return res.status(404).json({ message: 'User not found' });
    }
    users[index] = { ...users[index], ...req.body };
    await writeJsonFile(users);
    res.json(users[index]);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteUserById = async (req: Request, res: Response) => {
  try {
    let users = await readJsonFile();
    const index = users.findIndex((u: User) => u.id === parseInt(req.params.id));
    if (index === -1) {
      return res.status(404).json({ message: 'User not found' });
    }
    users = users.filter(u => u.id !== parseInt(req.params.id));
    await writeJsonFile(users);
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
