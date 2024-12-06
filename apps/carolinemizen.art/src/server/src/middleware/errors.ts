import express, { Request, Response, NextFunction } from 'express';

const router = express.Router();

const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  res.status(404);
  if (req.accepts('json')) {
    res.json({ error: 'Not found' });
    return;
  }
  res.type('txt').send('Not found');
};

const errorHandler = (error: Error, req: Request, res: Response, next: NextFunction) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    message: error.message,
    stack: process.env.NODE_ENV === 'production' ? '🥞' : error.stack,
  });
};

router.use(notFoundHandler);
router.use(errorHandler);

export default router;
