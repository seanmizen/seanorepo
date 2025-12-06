# MUI 7 + Dockview + RSBuild + Module Federation Architecture Guide

This guide documents a **clean, modern, senior-engineer-grade architecture** for building a modular application suite using:

- **React 19**
- **MUI 7** (with CSS variables enabled)
- **Dockview 4.x**
- **RSBuild** + **Module Federation v2**
- **Independent Panel Apps** (microfrontends)

It is intentionally concise, correct, and production-ready.

---

## 1. Architecture Overview

### Shell App (`apps/shell`)
- Owns:
  - **MUI ThemeProvider** (with CSS variables)
  - App layout: **AppBar + Drawer**
  - **Dockview workspace**
- Loads remote **Panel Apps** via Module Federation.
- Maintains a registry of available panels.

### Panel Apps (`apps/panel-xyz`)
- Independent builds & deployments.
- Each exposes **`./Panel`** → a React component.
- Panel root element **must** be:
  - `container-type: inline-size;`
  - `container-name: panel;`
- Use **MUI** UI components + container queries.
- Assume shell provides ThemeProvider.

---

**Guidelines**
- Shell handles global theming & structure.
- Panels contain feature logic only.
- No ThemeProvider inside panel apps.

---

## 3. RSBuild + Module Federation

### Shell `rsbuild.config.ts`

```ts
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: 'shell',
      remotes: {
        panelTodos: 'panelTodos@http://localhost:3001/mf-manifest.json',
        panelLogs: 'panelLogs@http://localhost:3002/mf-manifest.json',
      },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        '@mui/material': { singleton: true },
        '@mui/system': { singleton: true },
        '@emotion/react': { singleton: true },
        '@emotion/styled': { singleton: true },
      },
    }),
  ],
});
```

### Panel App `rsbuild.config.ts`

```ts
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';

export default defineConfig({
  server: { port: 3001 },
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: 'panelTodos',
      exposes: {
        './Panel': './src/PanelRoot.tsx',
      },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        '@mui/material': { singleton: true },
        '@mui/system': { singleton: true },
        '@emotion/react': { singleton: true },
        '@emotion/styled': { singleton: true },
      },
    }),
  ],
});
```

### Type Declarations for Remotes (Shell)

```ts
declare module 'panelTodos/Panel' {
  const Component: React.ComponentType;
  export default Component;
}
declare module 'panelLogs/Panel' {
  const Component: React.ComponentType;
  export default Component;
}
```

---

## 4. MUI Theme (CSS Variables Enabled)

```ts
// apps/shell/src/app/theme.ts
import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: { palette: { primary: { main: '#1976d2' } } },
    dark: { palette: { primary: { main: '#90caf9' } } },
  },
});
```

### Shell Entry

```tsx
// apps/shell/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { theme } from './app/theme';
import { AppShell } from './app/AppShell';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <AppShell />
  </ThemeProvider>
);
```

**Key points**
- One ThemeProvider only — inside the Shell.
- All Panel Apps receive theme + CSS vars implicitly.

---

## 5. Shell Layout (MUI-Only) + Dockview

Global CSS:

```css
@import 'dockview/dist/styles/dockview.css';
body { margin: 0; }
```

### `AppShell.tsx`

```tsx
import React, { useRef, Suspense } from 'react';
import {
  AppBar, Box, Drawer, Toolbar, Typography,
  List, ListItem, ListItemButton, ListItemText,
} from '@mui/material';
import { DockviewReact, DockviewReadyEvent, DockviewApi } from 'dockview';

// Lazy remote components
const TodosPanel = React.lazy(() => import('panelTodos/Panel'));
const LogsPanel = React.lazy(() => import('panelLogs/Panel'));

const dockComponents = {
  todos: TodosPanel,
  logs: LogsPanel,
};

const panelMeta = [
  { id: 'todos', title: 'Todos' },
  { id: 'logs', title: 'Logs' },
];

export const AppShell = () => {
  const dockApiRef = useRef<DockviewApi | null>(null);

  const handleReady = (ev: DockviewReadyEvent) => {
    dockApiRef.current = ev.api;
  };

  const openPanel = (key) => {
    dockApiRef.current?.addPanel({
      id: `${key}-${Date.now()}`,
      component: key,
      title: panelMeta.find(p => p.id === key)?.title ?? key,
    });
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: t => t.zIndex.drawer + 1 }}>
        <Toolbar><Typography>MUI + Dockview Suite</Typography></Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: 260,
          '& .MuiDrawer-paper': { width: 260, boxSizing: 'border-box' }
        }}
      >
        <Toolbar />
        <List>
          {panelMeta.map(p => (
            <ListItem key={p.id} disablePadding>
              <ListItemButton onClick={() => openPanel(p.id)}>
                <ListItemText primary={p.title} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Drawer>

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <Toolbar />
        <Box sx={{ flex: 1, minHeight: 0 }} className="dockview-theme-light">
          <Suspense fallback={null}>
            <DockviewReact
              components={dockComponents}
              onReady={handleReady}
            />
          </Suspense>
        </Box>
      </Box>
    </Box>
  );
};
```

**Notes**
- Layout uses **only MUI components**.
- Dockview sits inside `<main>` area.
- Panel components load lazily on first use.

---

## 6. Panel App Contract

### `PanelRoot.tsx`

```tsx
import React from 'react';
import { Box, Button, Typography, Stack } from '@mui/material';

const PanelRoot = () => {
  return (
    <Box
      sx={{
        containerType: 'inline-size',
        containerName: 'panel',
        width: '100%',
        height: '100%',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Typography variant="h6">Todos</Typography>

      <Stack
        spacing={2}
        sx={{
          '@/panel': { flexDirection: 'column' },
          '@600/panel': { flexDirection: 'row' },
        }}
      >
        <Button variant="contained">Add</Button>
        <Button variant="outlined">Filter</Button>
      </Stack>
    </Box>
  );
};

export default PanelRoot;
```

**Rules**
- **Outer Box = CSS Container** (`panel`).
- Use **MUI + sx** only.
- **No ThemeProvider**.
- Container queries via MUI shorthand:
  - `@600/panel` → `@container panel (min-width: 600px)`

### Optional Dev Entry (Local Dev Only)

```tsx
// devMain.tsx (not included in MF build)
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline, createTheme } from '@mui/material';
import PanelRoot from './PanelRoot';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={createTheme({ cssVariables: true })}>
    <CssBaseline />
    <PanelRoot />
  </ThemeProvider>
);
```

---

## 7. Adding a New Panel App

1. Create `apps/panel-new/`.
2. Implement `PanelRoot.tsx` with MUI + container root.
3. Configure `rsbuild.config.ts`:

   ```ts
   pluginModuleFederation({
     name: 'panelNew',
     exposes: { './Panel': './src/PanelRoot.tsx' },
     shared: { react: { singleton: true }, /* same as others */ },
   });
   ```

4. Register remote in shell:

   ```ts
   remotes: {
     ...,
     panelNew: 'panelNew@http://localhost:3003/mf-manifest.json'
   }
   ```

5. Add lazy import + metadata in shell:

   ```ts
   const NewPanel = React.lazy(() => import('panelNew/Panel'));
   dockComponents.new = NewPanel;
   panelMeta.push({ id: 'new', title: 'New Panel' });
   ```

Done — the panel instantly appears in the sidebar and launches inside Dockview.

---

## 8. Structural Guidelines (Summary)

### Shell
- Owns MUI theme + layout.
- One ThemeProvider.
- Panels registered via metadata list.
- Avoid custom CSS; use `sx` everywhere.

### Panels
- One root component.
- Outermost element is a **container**.
- Use container queries for responsive behavior.
- No global CSS, no theme provider.

### Module Federation
- Share:
  - `react`, `react-dom`
  - `@mui/material`, `@mui/system`
  - `@emotion/*`
- Panels expose only their root component.

---

## 9. Result

You now have:

- A **MUI-driven** application shell.
- **Theme tokens as CSS variables**.
- **Dockview** workspace with dynamic, lazy-loaded microfrontends.
- Fully **modular Panel Apps** using container queries.
- A **clean, scalable architecture** for an internal tool suite or IDE-like application.

---
