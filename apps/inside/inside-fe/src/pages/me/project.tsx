import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragHandleIcon from '@mui/icons-material/DragHandle';
import {
  Alert,
  Box,
  Button,
  Container,
  LinearProgress,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { StoredImage } from '@shared/types';
import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FailureAlert, FailureNotice } from '@/components';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';
import {
  ApiError,
  uploadImage,
  useMyProject,
  useSaveProject,
  useSaveProjectImages,
} from '@/features/designer-onboarding/use-my-studio';

const WORK_TYPES = [
  'full_home',
  'single_room',
  'kitchen',
  'bathroom',
  'extension',
  'new_build',
  'renovation',
  'commercial',
  'styling',
  'other',
] as const;

/**
 * The smallest variant that still reads as a photograph.
 *
 * The editor lists images at 96px wide, so serving the original would push
 * megabytes per row at a designer who is very likely on a phone. Falls back
 * through the map rather than assuming a key exists, because which variants
 * were generated depends on the source image's size.
 */
const thumbnailOf = (image: StoredImage): string => {
  const variants = Object.values(image.variants);
  const smallest = variants.sort((a, b) => a.width - b.width)[0];
  return smallest ? smallest.url : '';
};

interface Ordered {
  imageId: number;
  caption: string | null;
  image: StoredImage;
}

/**
 * One draggable image row.
 *
 * `useSortable` supplies a keyboard sensor as well as a pointer one, so the
 * order can be changed without a mouse — REQ-A11Y-002 covers this page like
 * any other, and drag-and-drop is the classic way to fail it.
 */
const SortableImage: FC<{ item: Ordered }> = ({ item }) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: item.imageId });

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      data-testid="project-image"
      data-image-id={item.imageId}
      sx={{
        p: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <Box
        component="button"
        type="button"
        aria-label={`Reorder ${item.image.alt ?? 'image'}`}
        {...attributes}
        {...listeners}
        sx={{
          display: 'flex',
          alignItems: 'center',
          background: 'none',
          border: 'none',
          cursor: 'grab',
          color: 'text.secondary',
          p: 0.5,
        }}
      >
        <DragHandleIcon />
      </Box>
      <Box
        component="img"
        src={thumbnailOf(item.image)}
        alt={item.image.alt ?? ''}
        sx={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 1 }}
      />
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
        {item.caption ?? item.image.alt ?? 'Untitled image'}
      </Typography>
    </Paper>
  );
};

const MyProjectEditor: FC = () => {
  const id = Number(useParams().id);
  const query = useMyProject(Number.isFinite(id) ? id : null);
  const save = useSaveProject();
  const saveImages = useSaveProjectImages();

  const [fields, setFields] = useState({
    title: '',
    summary: '',
    workType: '',
    location: '',
    completedYear: '',
    status: 'draft',
  });
  const [order, setOrder] = useState<Ordered[]>([]);
  /*
   * The caught error, plus what to say when it carries no wording of its own.
   *
   * Three different actions share this one surface, and they failed in three
   * different ways — reordering, uploading and saving are not interchangeable
   * to the designer reading the message. Keeping the fallback beside the cause
   * preserves that, while `FailureAlert` decides whether the cause has
   * something better to say (REQ-NET-007).
   */
  const [error, setError] = useState<{ cause: unknown; body: string } | null>(
    null,
  );
  const [progress, setProgress] = useState<number | null>(null);

  useBreadcrumbTitle(query.data?.project.title);

  useEffect(() => {
    if (!query.data) return;
    const { project, images } = query.data;
    setFields({
      title: project.title,
      summary: project.summary ?? '',
      workType: project.workType ?? '',
      location: project.location ?? '',
      completedYear: project.completedYear ? String(project.completedYear) : '',
      status: project.status,
    });
    setOrder(
      images.map((entry) => ({
        imageId: entry.imageId,
        caption: entry.caption,
        image: entry.image,
      })),
    );
  }, [query.data]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (query.isPending) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Typography variant="h1" sx={{ fontSize: { xs: 30, sm: 40 } }}>
          Your piece
        </Typography>
        <Skeleton variant="rectangular" height={280} sx={{ mt: 3 }} />
      </Container>
    );
  }

  /*
   * A piece that is not this designer's, or no longer exists, is answered
   * inline rather than by the catch-all 404 — the same choice the admin review
   * page makes, and what lets the route guard visit this path.
   *
   * The backend 404s for both "no such piece" and "not yours" on purpose:
   * telling one designer that another's piece exists is itself a leak. So a
   * 404 is the only status this page can honestly call missing.
   */
  if (
    query.isError &&
    query.error instanceof ApiError &&
    query.error.status === 404
  ) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Stack spacing={3} alignItems="flex-start">
          <Typography variant="h1" sx={{ fontSize: { xs: 30, sm: 40 } }}>
            Your piece
          </Typography>
          <Alert severity="info" data-testid="piece-missing">
            That piece is no longer available.
          </Alert>
        </Stack>
      </Container>
    );
  }

  /*
   * Everything else failed, and must not be dressed as a deletion —
   * REQ-QUALITY-001.
   *
   * `isError || !query.data` used to render the block above, so a 500 or a
   * dead tunnel told a designer their work was "no longer available", in
   * `severity="info"`, calmly. That is the precise misuse of `-missing` the
   * suffix convention was written after, reintroduced in a page the #217 sweep
   * did not reach.
   *
   * `!query.data` on a settled, non-error query is a success with no body —
   * a fourth thing again, and a failure rather than a missing record.
   */
  if (query.isError || !query.data) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <FailureNotice
          error={query.error}
          notFound={{
            title: 'Your piece',
            body: 'That piece is no longer available.',
          }}
          onRetry={() => query.refetch()}
          testId="piece-load-failure"
        />
      </Container>
    );
  }

  const persistOrder = async (next: Ordered[]) => {
    setOrder(next);
    setError(null);
    try {
      await saveImages.mutateAsync({
        id,
        images: next.map((entry) => ({
          imageId: entry.imageId,
          caption: entry.caption,
        })),
      });
    } catch (caught) {
      setError({ cause: caught, body: 'The new order could not be saved.' });
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.findIndex((entry) => entry.imageId === active.id);
    const to = order.findIndex((entry) => entry.imageId === over.id);
    if (from === -1 || to === -1) return;
    void persistOrder(arrayMove(order, from, to));
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const image = await uploadImage(file, ({ fraction }) =>
        setProgress(fraction),
      );
      await persistOrder([
        ...order,
        { imageId: image.id, caption: null, image },
      ]);
    } catch (caught) {
      // FailureAlert keeps the server's own wording for a refused upload,
      // which is what says what was wrong with the file.
      setError({ cause: caught, body: 'That image could not be uploaded.' });
    } finally {
      setProgress(null);
    }
  };

  const persistFields = async (next: Partial<typeof fields> = {}) => {
    const merged = { ...fields, ...next };
    setFields(merged);
    setError(null);
    try {
      await save.mutateAsync({
        id,
        fields: {
          title: merged.title.trim() || 'Untitled piece',
          summary: merged.summary.trim() || null,
          workType: merged.workType || null,
          location: merged.location.trim() || null,
          completedYear: merged.completedYear
            ? Number(merged.completedYear)
            : null,
          status: merged.status,
        },
      });
    } catch (caught) {
      setError({ cause: caught, body: 'That could not be saved.' });
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Typography variant="h1" sx={{ fontSize: { xs: 30, sm: 40 } }}>
          {fields.title || 'Untitled piece'}
        </Typography>

        {error && (
          // The retry is whichever control failed — Save, the upload input,
          // or dragging a row back — all of them still on screen.
          <FailureAlert
            error={error.cause}
            fallback={{ title: 'Not saved', body: error.body }}
            testId="project-error"
          />
        )}

        <Stack spacing={3}>
          <TextField
            label="Title"
            fullWidth={true}
            value={fields.title}
            onChange={(event) =>
              setFields({ ...fields, title: event.target.value })
            }
            inputProps={{ 'data-testid': 'piece-title' }}
          />
          <TextField
            label="Summary"
            multiline={true}
            minRows={3}
            fullWidth={true}
            value={fields.summary}
            onChange={(event) =>
              setFields({ ...fields, summary: event.target.value })
            }
            inputProps={{ 'data-testid': 'piece-summary' }}
          />
          <TextField
            select={true}
            label="Kind of work"
            fullWidth={true}
            value={fields.workType}
            onChange={(event) =>
              setFields({ ...fields, workType: event.target.value })
            }
            SelectProps={{
              SelectDisplayProps: {
                'data-testid': 'piece-work-type',
              } as Record<string, string>,
            }}
          >
            {WORK_TYPES.map((value) => (
              <MenuItem key={value} value={value}>
                {value.replace(/_/g, ' ')}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Box>
          <Typography variant="h2" sx={{ fontSize: 22, mb: 2 }}>
            Images
          </Typography>

          <Button
            component="label"
            variant="outlined"
            disabled={progress !== null}
          >
            {progress !== null ? 'Uploading…' : 'Add an image'}
            <input
              hidden={true}
              type="file"
              accept="image/*"
              data-testid="image-input"
              onChange={(event) => void onUpload(event.target.files?.[0])}
            />
          </Button>

          {/*
            Determinate where the browser reported a length, indeterminate
            where it did not — the bar never claims a position it does not
            know (REQ-STATE-002).
          */}
          {progress !== null && (
            <LinearProgress
              variant={progress > 0 ? 'determinate' : 'indeterminate'}
              value={progress > 0 ? progress * 100 : undefined}
              data-testid="upload-progress"
              sx={{ mt: 2 }}
            />
          )}

          <Box sx={{ mt: 3 }}>
            {order.length === 0 ? (
              <Typography color="text.secondary" data-testid="no-images">
                No images yet.
              </Typography>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={order.map((entry) => entry.imageId)}
                  strategy={verticalListSortingStrategy}
                >
                  <Stack spacing={1.5}>
                    {order.map((item) => (
                      <SortableImage key={item.imageId} item={item} />
                    ))}
                  </Stack>
                </SortableContext>
              </DndContext>
            )}
          </Box>
        </Box>

        <Stack direction="row" spacing={2}>
          <Button
            variant="contained"
            onClick={() => void persistFields()}
            disabled={save.isPending}
            data-testid="piece-save"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant={fields.status === 'published' ? 'outlined' : 'contained'}
            color="secondary"
            onClick={() =>
              void persistFields({
                status: fields.status === 'published' ? 'draft' : 'published',
              })
            }
            data-testid="piece-publish"
          >
            {fields.status === 'published' ? 'Unpublish' : 'Publish'}
          </Button>
        </Stack>
      </Stack>
    </Container>
  );
};

export { MyProjectEditor };
