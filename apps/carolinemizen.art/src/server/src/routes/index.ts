import express, { Request, Response } from 'express';
import users from './users';

const router = express.Router();

router.use('/users', users);

router.get('/', (_req: Request, res: Response) => {
  res.send('Hello World!');
});

export default router;
