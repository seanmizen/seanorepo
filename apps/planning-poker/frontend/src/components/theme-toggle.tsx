import { DarkMode, LightMode, SettingsBrightness } from '@mui/icons-material';
import { IconButton, Tooltip } from '@mui/material';
import { type FC, useState } from 'react';
import { getEffectiveMode, getInitialMode } from '@/app/provider';
import { eventBus } from '@/lib';

const ThemeToggle: FC = () => {
  const [mode, setMode] = useState<'light' | 'dark' | 'auto'>(getInitialMode);

  const handleToggle = () => {
    eventBus.emit('theme:toggle');
    setMode((prev) =>
      prev === 'light' ? 'dark' : prev === 'dark' ? 'auto' : 'light',
    );
  };

  const effectiveMode = getEffectiveMode(mode);
  const Icon =
    mode === 'auto'
      ? SettingsBrightness
      : effectiveMode === 'dark'
        ? DarkMode
        : LightMode;
  const label =
    mode === 'auto'
      ? 'Auto theme'
      : effectiveMode === 'dark'
        ? 'Dark mode'
        : 'Light mode';

  return (
    <Tooltip title={label}>
      <IconButton onClick={handleToggle} color="inherit">
        <Icon />
      </IconButton>
    </Tooltip>
  );
};

export { ThemeToggle };
