/* Stage 3 of the face shader story, as a page of its own. This is the
   only file in the folder written for the story. The rest are copies of the
   site's code at this stage, with only their import paths changed. */
import { Route } from 'react-router-dom';
import { mountSample } from '@/features/intentionality/mount-sample';
import { WithPortrait } from './layout';
import { Home } from './routes/home/home';
import { Projects } from './routes/projects/projects';

mountSample(
  <Route element={<WithPortrait />}>
    <Route path="/projects" element={<Projects />} />
    <Route path="/*" element={<Home />} />
  </Route>,
);
