import express from 'express';
import errors from './errors';

const router = express.Router();

router.use(errors);

export default router;
