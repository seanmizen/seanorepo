import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import { IconButton, Tooltip } from '@mui/material';
import type { FC } from 'react';
import { useThemeMode } from '@/app/theme-context';

const LABELS = {
  light: 'Light theme',
  dark: 'Dark theme',
  auto: 'Follow system theme',
} as const;

const ThemeToggle: FC = () => {
  const { mode, effectiveMode, toggleMode } = useThemeMode();

  const Icon =
    mode === 'auto'
      ? SettingsBrightnessIcon
      : effectiveMode === 'dark'
        ? DarkModeIcon
        : LightModeIcon;

  return (
    <Tooltip title={LABELS[mode]}>
      <IconButton onClick={toggleMode} aria-label={LABELS[mode]} size="small">
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
};

export { ThemeToggle };
