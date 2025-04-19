import { FC } from 'react';
import { Link } from 'react-router-dom';
import { FullScreenComponent } from '../../components';

const NotFound: FC = () => (
  <FullScreenComponent>
    <h1>404</h1>
    <p>Page not found</p>
    <Link to="/">Go home</Link>
  </FullScreenComponent>
);

export { NotFound };
