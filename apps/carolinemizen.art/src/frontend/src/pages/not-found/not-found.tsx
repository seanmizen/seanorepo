import { FC } from 'react';
import { Link } from 'react-router-dom';

const NotFound: FC = () => (
  <>
    <h1>404</h1>
    <p>Page not found</p>
    <Link to="/">Go home</Link>
  </>
);

export { NotFound };
