import {
  Alert,
  Box,
  Button,
  Container,
  MenuItem,
  Skeleton,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FailureAlert, FailureNotice } from '@/components';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';
import { useDraft } from '@/features/designer-onboarding/use-draft';
import {
  isNoProfileYet,
  useMyProfile,
  useSaveProfile,
  useSubmitProfile,
} from '@/features/designer-onboarding/use-my-studio';

const BUDGET_BANDS = [
  ['under_10k', 'Under £10k'],
  ['10k_25k', '£10k–£25k'],
  ['25k_50k', '£25k–£50k'],
  ['50k_100k', '£50k–£100k'],
  ['100k_250k', '£100k–£250k'],
  ['250k_plus', '£250k+'],
] as const;

const AVAILABILITY = [
  ['asap', 'Straight away'],
  ['within_3_months', 'Within 3 months'],
  ['within_6_months', 'Within 6 months'],
  ['within_12_months', 'Within 12 months'],
] as const;

interface ProfileDraft {
  studioName: string;
  headline: string;
  bio: string;
  location: string;
  websiteUrl: string;
  instagramUrl: string;
  budgetBand: string;
  availability: string;
}

const EMPTY: ProfileDraft = {
  studioName: '',
  headline: '',
  bio: '',
  location: '',
  websiteUrl: '',
  instagramUrl: '',
  budgetBand: '',
  availability: '',
};

const STEPS = ['Who you are', 'What you do', 'Review'];

/** Blank strings mean "not set" to the API, which wants null rather than ''. */
const forApi = (draft: ProfileDraft) =>
  Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [
      key,
      typeof value === 'string' && value.trim().length === 0
        ? null
        : (value as string).trim(),
    ]),
  );

/**
 * The onboarding editor.
 *
 * Split into steps because the alternative — one form with everything on it —
 * reads as a wall on a phone, and this is the funnel that decides whether good
 * designers join at all. Each step advance saves to the server, so progress
 * survives more than the session. `useDraft` covers the keystrokes since the
 * last save (REQ-ONBOARD-002).
 */
const MyProfileEditor: FC = () => {
  useBreadcrumbTitle('profile');
  const navigate = useNavigate();
  const query = useMyProfile();
  const save = useSaveProfile();
  const submit = useSubmitProfile();

  const existing = query.data?.profile ?? null;
  const [step, setStep] = useState(0);
  /*
   * `unknown`, so a caught rejection keeps knowing what it was — a 500, a
   * timeout, a dead connection — instead of being flattened to a sentence that
   * names the wrong culprit (REQ-NET-007). It also holds a plain string for
   * the page's own validation message, which `FailureAlert` shows verbatim.
   */
  const [error, setError] = useState<unknown>(null);

  const [draft, updateDraft, clearDraft] = useDraft<ProfileDraft>(
    'inside:profile-draft',
    existing
      ? {
          studioName: existing.studioName,
          headline: existing.headline ?? '',
          bio: existing.bio ?? '',
          location: existing.location ?? '',
          websiteUrl: existing.websiteUrl ?? '',
          instagramUrl: existing.instagramUrl ?? '',
          budgetBand: existing.budgetBand ?? '',
          availability: existing.availability ?? '',
        }
      : EMPTY,
  );

  if (query.isPending) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Skeleton variant="text" width={240} height={48} />
        <Skeleton variant="rectangular" height={300} sx={{ mt: 3 }} />
      </Container>
    );
  }

  /*
   * A failed load must not present itself as a blank new profile —
   * REQ-STATE-003.
   *
   * `existing` above collapses every failure into null, and null here means
   * "create". So a 500 rendered the empty onboarding form to a designer who
   * already had a studio, and the first save would POST as though they had
   * none. `useDraft` sometimes repopulated the fields from localStorage, which
   * made it intermittent rather than merely wrong.
   *
   * A 404 genuinely is "you have not started one" and still falls through to
   * the empty form, which is the whole point of the page.
   */
  if (query.isError && !isNoProfileYet(query.error)) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <FailureNotice
          error={query.error}
          notFound={{
            title: 'Your profile',
            body: 'We could not find your profile.',
          }}
          onRetry={() => query.refetch()}
          testId="profile-load-failure"
        />
      </Container>
    );
  }

  const field = (name: keyof ProfileDraft) => ({
    value: draft[name],
    onChange: (event: { target: { value: string } }) =>
      updateDraft({ [name]: event.target.value } as Partial<ProfileDraft>),
  });

  const persist = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        exists: existing !== null,
        fields: forApi(draft),
      });
      return true;
    } catch (caught) {
      setError(caught);
      return false;
    }
  };

  const next = async () => {
    if (step === 0 && draft.studioName.trim().length === 0) {
      setError('Your studio needs a name before we can save it.');
      return;
    }
    if (await persist()) setStep((current) => current + 1);
  };

  const submitForReview = async () => {
    if (!(await persist())) return;
    setError(null);
    try {
      await submit.mutateAsync();
      clearDraft();
      navigate('/me');
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 40 } }}>
          Your profile
        </Typography>

        <Stepper activeStep={step} alternativeLabel={true}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error != null && (
          // The retry is the stepper's own Next / Submit button below.
          <FailureAlert
            error={error}
            fallback={{
              title: 'Not saved',
              body: 'That could not be saved.',
            }}
            testId="profile-error"
          />
        )}

        {step === 0 && (
          <Stack spacing={3}>
            <TextField
              label="Studio name"
              required={true}
              fullWidth={true}
              inputProps={{ 'data-testid': 'field-studioName' }}
              {...field('studioName')}
            />
            <TextField
              label="Headline"
              helperText="One line. What you do, and for whom."
              fullWidth={true}
              inputProps={{ 'data-testid': 'field-headline' }}
              {...field('headline')}
            />
            <TextField
              label="About the studio"
              multiline={true}
              minRows={4}
              fullWidth={true}
              inputProps={{ 'data-testid': 'field-bio' }}
              {...field('bio')}
            />
          </Stack>
        )}

        {step === 1 && (
          <Stack spacing={3}>
            <TextField
              label="Where you work"
              helperText="The city or region you mostly take work in."
              fullWidth={true}
              inputProps={{ 'data-testid': 'field-location' }}
              {...field('location')}
            />
            <TextField
              select={true}
              label="Typical project budget"
              fullWidth={true}
              SelectProps={{
                SelectDisplayProps: {
                  'data-testid': 'field-budgetBand',
                } as Record<string, string>,
              }}
              {...field('budgetBand')}
            >
              {BUDGET_BANDS.map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select={true}
              label="When you could start"
              fullWidth={true}
              SelectProps={{
                SelectDisplayProps: {
                  'data-testid': 'field-availability',
                } as Record<string, string>,
              }}
              {...field('availability')}
            >
              {AVAILABILITY.map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Website"
              fullWidth={true}
              inputProps={{ 'data-testid': 'field-websiteUrl' }}
              {...field('websiteUrl')}
            />
            <TextField
              label="Instagram"
              fullWidth={true}
              inputProps={{ 'data-testid': 'field-instagramUrl' }}
              {...field('instagramUrl')}
            />
          </Stack>
        )}

        {step === 2 && (
          <Stack spacing={2} data-testid="profile-review">
            <Typography variant="h2" sx={{ fontSize: 24 }}>
              {draft.studioName}
            </Typography>
            {draft.headline && (
              <Typography color="text.secondary">{draft.headline}</Typography>
            )}
            {draft.bio && <Typography>{draft.bio}</Typography>}
            <Typography color="text.secondary">
              {[draft.location, draft.budgetBand, draft.availability]
                .filter(Boolean)
                .join(' · ') || 'No details added yet.'}
            </Typography>
            <Alert severity="info">
              Submitting sends your profile for review. It stays unlisted until
              we have looked at it.
            </Alert>
          </Stack>
        )}

        <Box>
          <Stack direction="row" spacing={2}>
            {step > 0 && (
              <Button
                onClick={() => setStep((current) => current - 1)}
                variant="text"
              >
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button
                onClick={next}
                variant="contained"
                disabled={save.isPending}
                data-testid="profile-next"
              >
                {save.isPending ? 'Saving…' : 'Save and continue'}
              </Button>
            ) : (
              <Button
                onClick={submitForReview}
                variant="contained"
                disabled={save.isPending || submit.isPending}
                data-testid="profile-submit"
              >
                {submit.isPending ? 'Submitting…' : 'Submit for review'}
              </Button>
            )}
          </Stack>
        </Box>
      </Stack>
    </Container>
  );
};

export { MyProfileEditor };
