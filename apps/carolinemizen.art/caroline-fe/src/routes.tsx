import type { FC } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ROUTES } from './constants';
import { NotFound } from './pages'; // as fallback

const AppRoutes: FC = () => {
  return (
    <BrowserRouter>
      <Routes location={''}>
        {Object.values(ROUTES)?.map((routeObject) => (
          <Route
            key={`str${routeObject.path}`}
            Component={NotFound}
            {...routeObject}
          />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

export { AppRoutes };
