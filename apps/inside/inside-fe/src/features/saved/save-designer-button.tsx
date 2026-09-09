import BookmarkIcon from '@mui/icons-material/Bookmark';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import {
  IconButton,
  Snackbar,
  type SxProps,
  type Theme,
  Tooltip,
} from '@mui/material';
import { type FC, type MouseEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { setPendingSave } from './pending-save';
import {
  useIsSaved,
  useSaveDesigner,
  useUnsaveDesigner,
} from './use-saved-designers';

/**
 * The save/unsave control. Used on a designer card and on the profile page —
 * same component, so the two can never disagree about what "saved" means.
 *
 * Signed out: REQ-PRODUCT-003. Clicking it stores the intent
 * (`setPendingSave`) and sends the visitor to sign up, carrying `returnTo`
 * back to wherever they clicked from. `auth-context.tsx`'s `verify()`
 * completes the save the moment signup succeeds, before it navigates back —
 * so by the time this component remounts on the returned-to page, the save
 * has already happened server-side and the first render is already correct.
 */
export const SaveDesignerButton: FC<{
  designerProfileId: number;
  studioName: string;
  sx?: SxProps<Theme>;
}> = ({ designerProfileId, studioName, sx }) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isSignedIn = user !== null;

  const query = useIsSaved(designerProfileId, isSignedIn);
  const save = useSaveDesigner();
  const unsave = useUnsaveDesigner();
  const [failed, setFailed] = useState(false);

  // Only a definite "yes" ever renders as saved. While the boot check is
  // still resolving, or while the membership check is still in flight, the
  // control shows its neutral, unsaved icon rather than guessing — REQ-STATE.
  const saved = isSignedIn && query.data?.saved === true;
  const busy = save.isPending || unsave.isPending || loading;

  const handleClick = async (event: MouseEvent) => {
    // Cards wrap the whole tile in a Link to the profile — this stops the
    // click from also navigating there.
    event.preventDefault();
    event.stopPropagation();
    setFailed(false);

    if (!isSignedIn) {
      setPendingSave(designerProfileId);
      const returnTo = `${location.pathname}${location.search}`;
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    try {
      if (saved) {
        await unsave.mutateAsync(designerProfileId);
      } else {
        await save.mutateAsync(designerProfileId);
      }
    } catch {
      setFailed(true);
    }
  };

  const label = saved
    ? `Remove ${studioName} from your shortlist`
    : `Save ${studioName} to your shortlist`;

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          sx={sx}
          onClick={handleClick}
          disabled={busy}
          aria-pressed={isSignedIn ? saved : undefined}
          aria-label={label}
          data-testid="save-designer"
        >
          {saved ? <BookmarkIcon color="primary" /> : <BookmarkBorderIcon />}
        </IconButton>
      </Tooltip>
      <Snackbar
        open={failed}
        autoHideDuration={4000}
        onClose={() => setFailed(false)}
        message={
          saved
            ? 'Could not remove that designer. Try again.'
            : 'Could not save that designer. Try again.'
        }
      />
    </>
  );
};
