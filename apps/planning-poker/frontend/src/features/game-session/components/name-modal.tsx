import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { type KeyboardEvent, useEffect, useState } from 'react';

type NameModalProps = {
  open: boolean;
  onSubmit: (name: string) => void;
  onSkip: () => void;
  lastUsedName?: string;
};

export const NameModal = ({
  open,
  onSubmit,
  onSkip,
  lastUsedName,
}: NameModalProps) => {
  const [nameInput, setNameInput] = useState(lastUsedName || '');

  // Update nameInput when modal opens or lastUsedName changes
  useEffect(() => {
    if (open) {
      setNameInput(lastUsedName || '');
    }
  }, [open, lastUsedName]);

  const handleSubmit = () => {
    const trimmedName = nameInput.trim();
    if (trimmedName) {
      // Store last used name globally
      localStorage.setItem('last-used-name', trimmedName);
      onSubmit(trimmedName);
      setNameInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSkip = () => {
    setNameInput('');
    onSkip();
  };

  return (
    <Dialog
      open={open}
      onClose={handleSkip}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 2,
            p: 1,
          },
        },
      }}
    >
      <DialogTitle>
        <Typography variant="h6" component="div">
          Welcome to Planning Poker!
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          What should we call you?
        </Typography>
        <TextField
          autoFocus
          fullWidth
          variant="outlined"
          placeholder="Enter your name"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleSkip}>Skip</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!nameInput.trim()}
        >
          Continue
        </Button>
      </DialogActions>
    </Dialog>
  );
};
