import { FC } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ROUTES } from './constants';
import { NotFound } from './pages'; // as fallback

const AppRoutes: FC = () => {
  return (
    <BrowserRouter>
      <Routes location={''}>
        {Object.values(ROUTES)?.map((routeObject, idx) => (
          <Route key={idx} Component={NotFound} {...routeObject} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

export { AppRoutes };
