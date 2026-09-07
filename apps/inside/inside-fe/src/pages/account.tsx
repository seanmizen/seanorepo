import {
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import type { FC, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { useChrome } from '@/contexts/chrome-context';

/**
 * A section of the account page.
 *
 * Extracted because the page is mostly structure, and naming the structure is
 * what makes the shape of the page legible — both to a reader and to whoever
 * adds the next section.
 */
const Section: FC<{
  title: string;
  description?: string;
  testId: string;
  children: ReactNode;
}> = ({ title, description, testId, children }) => (
  <Card variant="outlined" data-testid={testId}>
    <CardContent>
      <Stack spacing={2} alignItems="flex-start">
        <Stack spacing={0.5}>
          <Typography variant="h2" sx={{ fontSize: 20 }}>
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
        </Stack>
        {children}
      </Stack>
    </CardContent>
  </Card>
);

/**
 * The signed-in visitor's account.
 *
 * Scaffolded rather than minimal: the sections below are where saved
 * designers (#161), posted briefs (#162) and session management will live, and
 * showing the shape now means adding them is filling a slot rather than
 * redesigning a page.
 *
 * REQ-STATE-003 governs how the unbuilt parts are drawn. A section for a
 * feature that does not exist says it does not exist — it never renders an
 * empty list, a zero count, or a plausible placeholder, because those are
 * indistinguishable from real data and would be the app stating something it
 * has not verified.
 */
const Account: FC = () => {
  const { user, logout } = useAuth();
  const { statusCardVisible, setStatusCardVisible } = useChrome();
  const navigate = useNavigate();

  const isDesigner = user?.role === 'designer';

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Stack spacing={1.5}>
          <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 42 } }}>
            Your account
          </Typography>
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap={true}
          >
            <Typography color="text.secondary" data-testid="account-email">
              {user?.email}
            </Typography>
            <Chip label={user?.role} size="small" />
          </Stack>
        </Stack>

        {isDesigner ? (
          <Section
            title="Your studio"
            description="Your profile, your work, and where it is in review."
            testId="account-studio"
          >
            <Button component={Link} to="/me" variant="contained">
              Go to your studio
            </Button>
          </Section>
        ) : (
          <Section
            title="Your projects"
            description="Briefs you have posted, and the designers who responded."
            testId="account-projects"
          >
            {/*
              Not "you have no briefs" — that would be a claim about data we
              have not asked for. The feature does not exist yet, and saying so
              is the only honest thing available (REQ-STATE-003).
            */}
            <Typography variant="body2" color="text.secondary">
              Posting a project is not built yet. When it is, your briefs and
              the responses to them will live here.
            </Typography>
          </Section>
        )}

        <Section
          title="Saved designers"
          description="Studios you want to come back to."
          testId="account-saved"
        >
          <Typography variant="body2" color="text.secondary">
            Saving a designer is not built yet.
          </Typography>
        </Section>

        <Section
          title="Preferences"
          description="How the site behaves for you, on this browser."
          testId="account-preferences"
        >
          <FormControlLabel
            control={
              <Switch
                checked={statusCardVisible}
                onChange={(event) => setStatusCardVisible(event.target.checked)}
                data-testid="status-card-toggle"
              />
            }
            label="Show the deployment status card"
          />
          <Typography variant="body2" color="text.secondary">
            The floating card in the top-left corner showing which backend you
            are talking to. Remembered on this browser only.
          </Typography>
        </Section>

        <Section
          title="Session"
          description="You are signed in on this browser."
          testId="account-session"
        >
          <Button
            variant="outlined"
            onClick={async () => {
              // Leave the protected route BEFORE clearing the user. Clearing
              // it first makes ProtectedRoute bounce to /login, which is a
              // jarring place to land after deliberately signing out.
              navigate('/', { replace: true });
              try {
                await logout();
              } catch {
                /*
                 * `logout` throws when the server did not actually revoke the
                 * session, rather than clearing local state and claiming
                 * success (REQ-AUTH-006). Caught so a failure is not an
                 * unhandled rejection.
                 *
                 * The visible result is already honest: the visitor stays
                 * signed in, because they are. What is missing is telling them
                 * so, which needs a surface for session state — #215.
                 */
              }
            }}
          >
            Sign out
          </Button>
          <Divider flexItem={true} />
          <Typography variant="body2" color="text.secondary">
            Signing out of every browser at once is not built yet.
          </Typography>
        </Section>
      </Stack>
    </Container>
  );
};

export { Account };
