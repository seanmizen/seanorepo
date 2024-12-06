import express from 'express';
import {
  createUser,
  getUserById,
  updateUserById,
  deleteUserById,
  getUsers,
} from '../controllers/users';

const users = express.Router();

users.post('/', createUser);
users.get('/', getUsers);
users.get('/:id', getUserById);
users.patch('/:id', updateUserById);
users.delete('/:id', deleteUserById);

export default users;
