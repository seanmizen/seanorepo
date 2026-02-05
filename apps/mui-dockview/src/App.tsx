import type { PaletteColor, PaletteColorOptions, Theme } from '@mui/material';
import {
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CssBaseline,
  createTheme,
  Divider,
  Paper,
  Stack,
  ThemeProvider,
  Typography,
} from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
} from 'dockview';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

declare module '@mui/material/styles' {
  interface Palette {
    line1: PaletteColor;
    line2: PaletteColor;
  }
  interface PaletteOptions {
    line1?: PaletteColorOptions;
    line2?: PaletteColorOptions;
  }
}

declare module '@mui/material/Button' {
  interface ButtonPropsColorOverrides {
    line1: true;
    line2: true;
  }
}

import { BreakpointChip, usePanelBreakpoint } from './PanelBreakpoint';

type BrandKey = 'blue' | 'ocean' | 'fire';
type LineKey = 'northern' | 'central' | 'piccadilly' | 'victoria';

const brandThemes: Record<BrandKey, Theme> = {
  blue: createTheme({
    cssVariables: { cssVarPrefix: 'blue', colorSchemeSelector: 'class' },
    colorSchemes: {
      light: {
        palette: {
          primary: {
            main: '#006ec0',
            light: '#2ea9ff',
            dark: '#113992',
            contrastText: '#fff',
          },
          secondary: { main: '#a4b3bc', contrastText: '#000' },
          background: { default: '#f5f5f5', paper: '#ffffff' },
          text: { primary: '#000000' },
        },
      },
      dark: {
        palette: {
          primary: {
            main: '#2ea9ff',
            light: '#6bc4ff',
            dark: '#006ec0',
            contrastText: '#000',
          },
          secondary: { main: '#8aa2ad', contrastText: '#fff' },
          background: { default: '#121212', paper: '#1e1e1e' },
          text: { primary: '#ffffff' },
        },
      },
    },
  }),

  ocean: createTheme({
    cssVariables: { cssVarPrefix: 'ocean', colorSchemeSelector: 'class' },
    colorSchemes: {
      light: {
        palette: {
          primary: {
            main: '#0288d1',
            light: '#5eb8ff',
            dark: '#005b9f',
            contrastText: '#fff',
          },
          secondary: { main: '#00acc1', contrastText: '#000' },
          background: { default: '#e0f7fa', paper: '#ffffff' },
          text: { primary: '#000000' },
        },
      },
      dark: {
        palette: {
          primary: {
            main: '#29b6f6',
            light: '#73e8ff',
            dark: '#0086c3',
            contrastText: '#000',
          },
          secondary: { main: '#26c6da', contrastText: '#000' },
          background: { default: '#004d61', paper: '#006978' },
          text: { primary: '#ffffff' },
        },
      },
    },
  }),

  fire: createTheme({
    cssVariables: { cssVarPrefix: 'fire', colorSchemeSelector: 'class' },
    colorSchemes: {
      light: {
        palette: {
          primary: {
            main: '#d32f2f',
            light: '#ff6659',
            dark: '#9a0007',
            contrastText: '#fff',
          },
          secondary: { main: '#ff6f00', contrastText: '#000' },
          background: { default: '#fff3e0', paper: '#ffffff' },
          text: { primary: '#000000' },
        },
      },
      dark: {
        palette: {
          primary: {
            main: '#f44336',
            light: '#ff7961',
            dark: '#ba000d',
            contrastText: '#fff',
          },
          secondary: { main: '#ff9800', contrastText: '#000' },
          background: { default: '#1a0000', paper: '#2d0000' },
          text: { primary: '#ffffff' },
        },
      },
    },
  }),
};

interface LinePalette {
  line1: PaletteColorOptions;
  line2: PaletteColorOptions;
}

const linePalettes: Record<LineKey, LinePalette> = {
  northern: {
    line1: {
      main: '#000000',
      light: '#424242',
      dark: '#000000',
      contrastText: '#fff',
    },
    line2: {
      main: '#757575',
      light: '#9e9e9e',
      dark: '#616161',
      contrastText: '#fff',
    },
  },
  central: {
    line1: {
      main: '#dc241f',
      light: '#e57373',
      dark: '#b71c1c',
      contrastText: '#fff',
    },
    line2: {
      main: '#f44336',
      light: '#ff6659',
      dark: '#d32f2f',
      contrastText: '#fff',
    },
  },
  piccadilly: {
    line1: {
      main: '#003688',
      light: '#5472d3',
      dark: '#002171',
      contrastText: '#fff',
    },
    line2: {
      main: '#1976d2',
      light: '#63a4ff',
      dark: '#004ba0',
      contrastText: '#fff',
    },
  },
  victoria: {
    line1: {
      main: '#0098d4',
      light: '#63ccff',
      dark: '#006db3',
      contrastText: '#fff',
    },
    line2: {
      main: '#00bcd4',
      light: '#62efff',
      dark: '#008ba3',
      contrastText: '#000',
    },
  },
};

interface GlobalLineContextValue {
  line: LineKey;
  setLine: (line: LineKey) => void;
  globalBrand: BrandKey;
  setGlobalBrand: (brand: BrandKey) => void;
}

const GlobalLineContext = createContext<GlobalLineContextValue | undefined>(
  undefined,
);

function useGlobalLine() {
  const ctx = useContext(GlobalLineContext);
  if (!ctx) throw new Error('useGlobalLine must be within GlobalLineProvider');
  return ctx;
}

function GlobalLineProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [line, setLine] = useState<LineKey>('northern');
  const [globalBrand, setGlobalBrand] = useState<BrandKey>('blue');

  const contextValue = useMemo(
    () => ({ line, setLine, globalBrand, setGlobalBrand }),
    [line, globalBrand],
  );

  return (
    <GlobalLineContext.Provider value={contextValue}>
      {children}
    </GlobalLineContext.Provider>
  );
}

function BrandThemeProvider({
  children,
  brand,
}: Readonly<{
  children: ReactNode;
  brand: BrandKey;
}>) {
  const { line } = useGlobalLine();

  const theme = useMemo(() => {
    const lineColors = linePalettes[line];
    const baseTheme = brandThemes[brand] as Theme & {
      colorSchemes?: {
        light?: { palette?: Partial<Theme['palette']> };
        dark?: { palette?: Partial<Theme['palette']> };
      };
    };

    return createTheme({
      cssVariables: baseTheme.cssVariables,
      colorSchemes: {
        light: {
          palette: {
            ...(baseTheme.colorSchemes?.light?.palette || {}),
            line1: lineColors.line1,
            line2: lineColors.line2,
          },
        },
        dark: {
          palette: {
            ...(baseTheme.colorSchemes?.dark?.palette || {}),
            line1: lineColors.line1,
            line2: lineColors.line2,
          },
        },
      },
    });
  }, [brand, line]);

  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

function GlobalControls() {
  const { mode, setMode } = useColorScheme();
  const { line, setLine, globalBrand, setGlobalBrand } = useGlobalLine();

  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 1 }}
    >
      <Box>
        <Typography variant="caption" sx={{ mb: 1, display: 'block' }}>
          Brand (Global)
        </Typography>
        <ButtonGroup size="small">
          <Button
            variant={globalBrand === 'blue' ? 'contained' : 'outlined'}
            onClick={() => setGlobalBrand('blue')}
          >
            Blue
          </Button>
          <Button
            variant={globalBrand === 'ocean' ? 'contained' : 'outlined'}
            onClick={() => setGlobalBrand('ocean')}
          >
            Ocean
          </Button>
          <Button
            variant={globalBrand === 'fire' ? 'contained' : 'outlined'}
            onClick={() => setGlobalBrand('fire')}
          >
            Fire
          </Button>
        </ButtonGroup>
      </Box>
      <Box>
        <Typography variant="caption" sx={{ mb: 1, display: 'block' }}>
          Mode (Global)
        </Typography>
        <ButtonGroup size="small">
          <Button
            variant={mode === 'light' ? 'contained' : 'outlined'}
            onClick={() => setMode('light')}
          >
            Light
          </Button>
          <Button
            variant={mode === 'dark' ? 'contained' : 'outlined'}
            onClick={() => setMode('dark')}
          >
            Dark
          </Button>
        </ButtonGroup>
      </Box>
      <Box>
        <Typography variant="caption" sx={{ mb: 1, display: 'block' }}>
          Independent Theme (Global)
        </Typography>
        <ButtonGroup size="small">
          <Button
            variant={line === 'northern' ? 'contained' : 'outlined'}
            onClick={() => setLine('northern')}
          >
            Northern
          </Button>
          <Button
            variant={line === 'central' ? 'contained' : 'outlined'}
            onClick={() => setLine('central')}
          >
            Central
          </Button>
          <Button
            variant={line === 'piccadilly' ? 'contained' : 'outlined'}
            onClick={() => setLine('piccadilly')}
          >
            Piccadilly
          </Button>
          <Button
            variant={line === 'victoria' ? 'contained' : 'outlined'}
            onClick={() => setLine('victoria')}
          >
            Victoria
          </Button>
        </ButtonGroup>
      </Box>
    </Stack>
  );
}

function PanelBrandSelector({
  brand,
  onBrandChange,
}: Readonly<{
  brand: BrandKey | 'inherit';
  onBrandChange: (brand: BrandKey | 'inherit') => void;
}>) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" sx={{ mb: 1, display: 'block' }}>
        Panel Brand
      </Typography>
      <ButtonGroup size="small">
        <Button
          variant={brand === 'inherit' ? 'contained' : 'outlined'}
          onClick={() => onBrandChange('inherit')}
        >
          Inherit
        </Button>
        <Button
          variant={brand === 'blue' ? 'contained' : 'outlined'}
          onClick={() => onBrandChange('blue')}
        >
          Blue
        </Button>
        <Button
          variant={brand === 'ocean' ? 'contained' : 'outlined'}
          onClick={() => onBrandChange('ocean')}
        >
          Ocean
        </Button>
        <Button
          variant={brand === 'fire' ? 'contained' : 'outlined'}
          onClick={() => onBrandChange('fire')}
        >
          Fire
        </Button>
      </ButtonGroup>
    </Box>
  );
}

function LineDemo({ brand }: Readonly<{ brand: BrandKey }>) {
  const { line } = useGlobalLine();

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Stack spacing={2}>
        <Card>
          <CardHeader
            title={`${brand.toUpperCase()} Brand Theme`}
            subheader={`Line: ${line.toUpperCase()}`}
            action={<Chip label={brand} color="primary" size="small" />}
          />
          <Divider />
          <CardContent>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Line colors (global across all panels)
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              flexWrap="wrap"
              useFlexGap
              sx={{ mb: 2 }}
            >
              <Button variant="contained" color="line1" size="small">
                Line 1
              </Button>
              <Button variant="contained" color="line2" size="small">
                Line 2
              </Button>
              <Button variant="outlined" color="line1" size="small">
                Line 1 Outlined
              </Button>
              <Button variant="outlined" color="line2" size="small">
                Line 2 Outlined
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Brand colors (globally inherited OR set per-panel)
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="contained" color="primary" size="small">
                Primary
              </Button>
              <Button variant="contained" color="secondary" size="small">
                Secondary
              </Button>
              <Button variant="outlined" color="primary" size="small">
                Primary Outlined
              </Button>
              <Button variant="outlined" color="secondary" size="small">
                Secondary Outlined
              </Button>
            </Stack>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Color Swatches" />
          <Divider />
          <CardContent>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Line Colors
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <Box
                sx={{
                  bgcolor: 'line1.main',
                  color: 'line1.contrastText',
                  p: 2,
                  borderRadius: 1,
                  minWidth: 80,
                  textAlign: 'center',
                }}
              >
                Line 1
              </Box>
              <Box
                sx={{
                  bgcolor: 'line2.main',
                  color: 'line2.contrastText',
                  p: 2,
                  borderRadius: 1,
                  minWidth: 80,
                  textAlign: 'center',
                }}
              >
                Line 2
              </Box>
            </Stack>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Brand Colors
            </Typography>
            <Stack direction="row" spacing={1}>
              <Box
                sx={{
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  p: 2,
                  borderRadius: 1,
                  minWidth: 80,
                  textAlign: 'center',
                }}
              >
                Primary
              </Box>
              <Box
                sx={{
                  bgcolor: 'secondary.main',
                  color: 'secondary.contrastText',
                  p: 2,
                  borderRadius: 1,
                  minWidth: 80,
                  textAlign: 'center',
                }}
              >
                Secondary
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}

const PanelWithBrandSelector = () => {
  const { panelRef, panelWidth, currentBreakpoint, chipVisible } =
    usePanelBreakpoint();
  const [brand, setBrand] = useState<BrandKey | 'inherit'>('inherit');
  const { line, globalBrand } = useGlobalLine();

  const effectiveBrand = brand === 'inherit' ? globalBrand : brand;

  const panelTheme = useMemo(() => {
    const lineColors = linePalettes[line];
    const baseTheme = brandThemes[effectiveBrand] as Theme & {
      colorSchemes?: {
        light?: { palette?: Partial<Theme['palette']> };
        dark?: { palette?: Partial<Theme['palette']> };
      };
    };

    return createTheme({
      cssVariables: baseTheme.cssVariables,
      colorSchemes: {
        light: {
          palette: {
            ...(baseTheme.colorSchemes?.light?.palette || {}),
            line1: lineColors.line1,
            line2: lineColors.line2,
          },
        },
        dark: {
          palette: {
            ...(baseTheme.colorSchemes?.dark?.palette || {}),
            line1: lineColors.line1,
            line2: lineColors.line2,
          },
        },
      },
    });
  }, [effectiveBrand, line]);

  return (
    <ThemeProvider theme={panelTheme}>
      <Paper
        ref={panelRef}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          bgcolor: 'background.default',
          borderRadius: 0,
        }}
        elevation={0}
      >
        <BreakpointChip
          width={panelWidth}
          breakpoint={currentBreakpoint}
          visible={chipVisible}
        />
        <Box
          sx={{
            p: 2,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <PanelBrandSelector brand={brand} onBrandChange={setBrand} />
        </Box>
        <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
          <LineDemo brand={effectiveBrand} />
        </Box>
      </Paper>
    </ThemeProvider>
  );
};

const PanelWithoutBrandSelector = ({
  params,
}: Readonly<{ params: { brand: BrandKey } }>) => {
  const { panelRef, panelWidth, currentBreakpoint, chipVisible } =
    usePanelBreakpoint();

  return (
    <BrandThemeProvider brand={params.brand}>
      <Paper
        ref={panelRef}
        sx={{
          height: '100%',
          position: 'relative',
          bgcolor: 'background.default',
          borderRadius: 0,
        }}
        elevation={0}
      >
        <BreakpointChip
          width={panelWidth}
          breakpoint={currentBreakpoint}
          visible={chipVisible}
        />
        <LineDemo brand={params.brand} />
      </Paper>
    </BrandThemeProvider>
  );
};

const components = {
  withSelector: PanelWithBrandSelector,
  withoutSelector: PanelWithoutBrandSelector,
};

function AppWithTheme({
  disablePanelDrag,
  setDisablePanelDrag,
  disableGroupDrag,
  setDisableGroupDrag,
  disableOverlay,
  setDisableOverlay,
  onReady,
}: Readonly<{
  disablePanelDrag: boolean;
  setDisablePanelDrag: (v: boolean) => void;
  disableGroupDrag: boolean;
  setDisableGroupDrag: (v: boolean) => void;
  disableOverlay: boolean;
  setDisableOverlay: (v: boolean) => void;
  onReady: (event: DockviewReadyEvent) => void;
}>) {
  const { globalBrand } = useGlobalLine();

  return (
    <BrandThemeProvider brand={globalBrand}>
      <CssBaseline enableColorScheme />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ p: 2, bgcolor: 'background.default' }}
        >
          <GlobalControls />
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setDisablePanelDrag(!disablePanelDrag)}
            >{`Panel Drag: ${disablePanelDrag ? 'OFF' : 'ON'}`}</Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setDisableGroupDrag(!disableGroupDrag)}
            >{`Group Drag: ${disableGroupDrag ? 'OFF' : 'ON'}`}</Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setDisableOverlay(!disableOverlay)}
            >{`Overlay: ${disableOverlay ? 'OFF' : 'ON'}`}</Button>
          </Stack>
        </Stack>
        <Box sx={{ flexGrow: 1 }}>
          <DockviewReact
            className="dockview-theme-abyss"
            onReady={onReady}
            components={components}
          />
        </Box>
      </Box>
    </BrandThemeProvider>
  );
}

function Component() {
  const [disablePanelDrag, setDisablePanelDrag] = useState<boolean>(false);
  const [disableGroupDrag, setDisableGroupDrag] = useState<boolean>(false);
  const [disableOverlay, setDisableOverlay] = useState<boolean>(false);
  const [api, setApi] = useState<DockviewApi>();

  useEffect(() => {
    if (!api) return;

    const disposables = [
      api.onWillDragPanel((e) => {
        if (!disablePanelDrag) return;
        e.nativeEvent.preventDefault();
      }),
      api.onWillDragGroup((e) => {
        if (!disableGroupDrag) return;
        e.nativeEvent.preventDefault();
      }),
      api.onWillShowOverlay((e) => {
        if (!disableOverlay) return;
        e.preventDefault();
      }),
    ];

    return () => disposables.forEach((d) => d.dispose());
  }, [api, disablePanelDrag, disableGroupDrag, disableOverlay]);

  const onReady = (event: DockviewReadyEvent) => {
    setApi(event.api);
    event.api.addPanel({
      id: 'panel_blue_with_selector',
      component: 'withSelector',
      params: { brand: 'blue' },
      title: 'Blue (editable)',
    });
    event.api.addPanel({
      id: 'panel_ocean_fixed',
      component: 'withSelector',
      params: { brand: 'ocean' },
      title: 'Ocean (editable)',
      position: {
        direction: 'right',
        referencePanel: 'panel_blue_with_selector',
      },
    });
    event.api.addPanel({
      id: 'panel_fire_with_selector',
      component: 'withSelector',
      params: { brand: 'fire' },
      title: 'Fire (editable)',
      position: {
        direction: 'right',
        referencePanel: 'panel_blue_with_selector',
      },
    });
  };

  return (
    <GlobalLineProvider>
      <AppWithTheme
        disablePanelDrag={disablePanelDrag}
        setDisablePanelDrag={setDisablePanelDrag}
        disableGroupDrag={disableGroupDrag}
        setDisableGroupDrag={setDisableGroupDrag}
        disableOverlay={disableOverlay}
        setDisableOverlay={setDisableOverlay}
        onReady={onReady}
      />
    </GlobalLineProvider>
  );
}

export default Component;
