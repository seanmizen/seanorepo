import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { type FC, useEffect, useState } from 'react';
import { api } from '@/config';

const NamePromptProvider: FC = () => {
  const [showPrompt, setShowPrompt] = useState(false);
  const [name, setName] = useState('');
  const [currentUrl, setCurrentUrl] = useState(window.location.href);

  // Get session code from URL without using useSearchParams (to avoid Router dependency)
  const getSessionCode = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('session-code');
  };

  // Listen for URL changes
  useEffect(() => {
    const handleUrlChange = () => {
      setCurrentUrl(window.location.href);
    };

    // Listen to popstate (back/forward buttons)
    window.addEventListener('popstate', handleUrlChange);

    // Listen to custom navigation events (for client-side routing)
    window.addEventListener('locationchange', handleUrlChange);

    // Poll for URL changes (backup for client-side routing)
    const interval = setInterval(() => {
      if (window.location.href !== currentUrl) {
        handleUrlChange();
      }
    }, 100);

    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('locationchange', handleUrlChange);
      clearInterval(interval);
    };
  }, [currentUrl]);

  // Check for session code and show prompt if needed
  useEffect(() => {
    const sessionCode = getSessionCode();

    // Reset showPrompt when URL changes
    setShowPrompt(false);

    // Only show prompt if we're in a game session
    if (!sessionCode) {
      console.log(
        '[NamePromptProvider] Not in a game session, not showing prompt',
      );
      return;
    }

    // Check if name exists for this specific game session
    const sessionStorageKey = `planning-poker-name-${sessionCode}`;
    const storedName = sessionStorage.getItem(sessionStorageKey);
    console.log(
      `[NamePromptProvider] Checking for stored name for session ${sessionCode}:`,
      storedName,
    );
    if (!storedName) {
      console.log(
        '[NamePromptProvider] No name found for this session, showing prompt',
      );
      setShowPrompt(true);
    } else {
      console.log(
        '[NamePromptProvider] Name found for this session, not showing prompt',
      );
    }
  }, [currentUrl]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const sessionCode = getSessionCode();
    if (!trimmedName || !sessionCode) return;

    // Store in sessionStorage for this specific game session
    const sessionStorageKey = `planning-poker-name-${sessionCode}`;
    sessionStorage.setItem(sessionStorageKey, trimmedName);
    console.log(
      `[NamePromptProvider] Stored name for session ${sessionCode}:`,
      trimmedName,
    );

    // Send to backend if user session exists
    const userSessionId = localStorage.getItem('user-session-id');
    if (userSessionId) {
      try {
        await fetch(`${api.baseUrl}/api/user-session/${userSessionId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: trimmedName }),
        });
      } catch (error) {
        console.error('Failed to update user name on backend:', error);
      }
    }

    setShowPrompt(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  console.log('[NamePromptProvider] Rendering, showPrompt:', showPrompt);

  if (!showPrompt) return null;

  return (
    <Box sx={{ position: 'fixed', bottom: 16, right: 16, zIndex: 10000 }}>
      <Alert
        severity="info"
        variant="filled"
        sx={{ minWidth: 300 }}
        // No onClose prop - makes it non-dismissible
      >
        <Stack spacing={2}>
          <Box>What's your name?</Box>
          <TextField
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter your name"
            autoFocus
            sx={{
              '& .MuiInputBase-root': {
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
              },
            }}
          />
          <Button
            variant="contained"
            size="small"
            onClick={handleSubmit}
            disabled={!name.trim()}
            sx={{ alignSelf: 'flex-end' }}
          >
            Submit
          </Button>
        </Stack>
      </Alert>
    </Box>
  );
};

export { NamePromptProvider };
