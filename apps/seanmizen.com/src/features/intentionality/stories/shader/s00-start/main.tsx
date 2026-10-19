/* Stage 0 of the face shader story, as a page of its own. This is the
   only file in the folder written for the story. The rest are copies of the
   site's code at this stage, with only their import paths changed. */
import { Route } from 'react-router-dom';
import { mountSample } from '@/features/intentionality/mount-sample';
import { Apps } from './routes/apps/apps';
import { Home } from './routes/home/home';

mountSample(
  <>
    <Route path="/apps" element={<Apps />} />
    <Route path="/*" element={<Home />} />
  </>,
);
