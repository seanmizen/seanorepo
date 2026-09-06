import {
  Card,
  CardActionArea,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { Link } from 'react-router-dom';

/**
 * The admin landing page.
 *
 * It exists partly because `/admin/designers/:id` needs every ancestor to be a
 * real, visitable page (see the standing rule in app/routes.ts), and partly so
 * later admin sections have somewhere to be listed.
 */
const AdminHome: FC = () => (
  <Container maxWidth="md" sx={{ py: 6 }}>
    <Stack spacing={3}>
      <Typography variant="h3" component="h1">
        Admin
      </Typography>
      <Card variant="outlined">
        <CardActionArea component={Link} to="/admin/designers" sx={{ p: 3 }}>
          <Typography variant="h6" component="h2">
            Designer review queue
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Approve or reject designer profiles before they appear on the site.
          </Typography>
        </CardActionArea>
      </Card>
    </Stack>
  </Container>
);

export { AdminHome };
