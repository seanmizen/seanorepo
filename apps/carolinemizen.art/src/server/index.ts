import express, { NextFunction, Request, Response } from 'express'; // express from 'express';
import bodyParser from 'body-parser';
import routes from './src/routes';
import middleware from './src/middleware';
// import { pool } from './db/connection';
import { SlonikError } from 'slonik';
import createSlonikPool from './db/connection';

/**
 * Wrap express app in a main function to allow async/await for Slonik
 * (see https://dev.to/gajus/integrating-slonik-with-expressjs-33kn)
 */
const main = async () => {
  const app = express();
  const port = process.env.PORT || 5174;

  // Body parser middleware to parse JSON requests
  app.use(bodyParser.json());

  app.use('/', routes);

  app.use(middleware); // currently errors only - is this middleware?

  // Connect to the database
  // const pool = await createSlonikPool();

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
};

main();
