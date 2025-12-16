# AMAZON_Q_GUIDE.md — Multi-tenant MUI with Pigment CSS (Dockview + Module Federation)

## Definitions

- **design-system**: our reusable library that re-exports MUI (Pigment adapter) + shared themes + shared components/types.
- **shell-ui**: the host app (Dockview). Owns global CSS and mounts MF apps into panels.
- **MF apps**: module-federated sub-apps. They consume **design-system** (and may call shell-ui contracts), but must not create global styling side-effects.

Constraints:

- Multiple tenants open at once (per panel).
- Each tenant supports Light/Dark.
- Themes are known at compile time.
- We accept slower FCP in exchange for snappier UI + lower JS overhead.

---

## Golden rules

1. **Pigment everywhere**  
   All UI builds (shell-ui + each MF app) must build with Pigment CSS tooling and import the MUI Pigment stylesheet.

2. **One global ThemeProvider, per-panel scheme scope**  
   Use a single MUI theme object (from design-system). Select tenant+mode **by scoping CSS variables on the panel root** using a class like `.ds-companyA-light`.

3. **No `<html>` / global mode toggles**  
   Never set global color scheme in MF apps. No global ThemeProvider mutations. Only panel subtree scoping.

4. **Portals must stay inside the panel root**  
   Menus, dialogs, tooltips must render into the same panel subtree; otherwise they will pick up the wrong tenant scheme.

5. **Avoid runtime-dependent styles** (Pigment extraction)  
   No `sx={{ color: someState }}`. Use:

- build-time variants, or
- inline CSS variables (`style={{ '--x': value }}`) + `var(--x)` in styles.

---

## Required docs (read when changing this)

- MUI Pigment CSS migration guide: https://mui.com/material-ui/migration/migrating-to-pigment-css/
- Pigment CSS overview: https://mui.com/material-ui/experimental-api/pigment-css/

---

## 1) Packages & re-exports (design-system)

### design-system must re-export from the Pigment adapter

Prefer re-exporting components from `@mui/material-pigment-css/*` (not `@mui/material/*`) to avoid mixed behavior.

Create:

- `packages/design-system/src/mui.ts` (public entrypoint)
- `packages/design-system/src/theme/*` (public theme + types)

Example re-export surface (minimal):

```ts
// packages/design-system/src/mui.ts
export { styled, useTheme } from "@mui/material-pigment-css";
export { default as Box } from "@mui/material-pigment-css/Box";
export { default as Grid } from "@mui/material-pigment-css/Grid";
export { default as Stack } from "@mui/material-pigment-css/Stack";
export { default as Container } from "@mui/material-pigment-css/Container";

export { ThemeProvider, createTheme } from "@mui/material/styles";
export { DefaultPropsProvider } from "@mui/material/DefaultPropsProvider";

// Re-export component APIs you standardize on:
// export { Button, Typography, ... } from '@mui/material-pigment-css/...';
```

MF apps should import UI primitives from **design-system**, not directly from MUI.

---

## 2) Theme registry model (design-system)

We compile all tenant schemes up-front.

### Scheme naming

`SchemeName = \`\${TenantId}-\${Mode}\`` 
Example:`companyA-light`, `companyB-dark`

### Theme creation

- `cssVariables: true`
- `cssVarPrefix: 'ds'`
- `colorSchemeSelector: '.ds-%s'`
- `colorSchemes` contains every scheme name

Example:

```ts
// packages/design-system/src/theme/theme.ts
import { createTheme } from "@mui/material/styles";

export type TenantId = "companyA" | "companyB";
export type Mode = "light" | "dark";
export type SchemeName = `${TenantId}-${Mode}`;

export const schemeName = (tenant: TenantId, mode: Mode): SchemeName =>
  `${tenant}-${mode}` as const;

const scheme = (tenant: TenantId, mode: Mode) => ({
  palette: {
    mode,
    primary: tenant === "companyA" ? { main: "#1d4ed8" } : { main: "#16a34a" },
    secondary:
      tenant === "companyA" ? { main: "#9333ea" } : { main: "#f97316" },

    // Gradients token model (see section 3)
    gradient: {
      hero: {
        from: tenant === "companyA" ? "#1d4ed8" : "#16a34a",
        to: tenant === "companyA" ? "#9333ea" : "#f97316",
      },
    },
  },
});

export const dsTheme = createTheme({
  cssVariables: {
    cssVarPrefix: "ds",
    colorSchemeSelector: ".ds-%s",
  },
  colorSchemes: {
    "companyA-light": scheme("companyA", "light"),
    "companyA-dark": scheme("companyA", "dark"),
    "companyB-light": scheme("companyB", "light"),
    "companyB-dark": scheme("companyB", "dark"),
  },
});
```

---

## 3) Extensible palette: GRADIENTS (token model)

We store gradient stops (not computed colors) per scheme:

```ts
palette: {
  gradient: {
    hero: {
      from: string;
      to: string;
    }
  }
}
```

### TypeScript augmentation

```ts
// packages/design-system/src/theme/augment.d.ts
import "@mui/material/themeCssVarsAugmentation";

declare module "@mui/material/styles" {
  interface Palette {
    gradient: {
      hero: { from: string; to: string };
    };
  }
  interface PaletteOptions {
    gradient?: {
      hero?: { from?: string; to?: string };
    };
  }
}
```

### Usage pattern (Pigment-friendly)

Prefer CSS variables via `theme.vars` (not runtime mode branching):

```ts
import { styled } from "@mui/material-pigment-css";

export const Hero = styled("div")(({ theme }) => ({
  backgroundImage: `linear-gradient(90deg, ${theme.vars.palette.gradient.hero.from}, ${theme.vars.palette.gradient.hero.to})`,
}));
```

---

## 4) Pigment build integration (shell-ui + each MF app)

### Install

```bash
npm install @mui/material-pigment-css @pigment-css/react
npm install --save-dev @pigment-css/vite-plugin # for Vite
npm install --save-dev @pigment-css/nextjs-plugin # for Next.js (webpack v5)
```

### Import stylesheet (required)

In **shell-ui** and any app that renders UI (top-level entry):

```ts
import "@mui/material-pigment-css/styles.css";
```

### Configure bundler plugin (required)

#### Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { pigment } from "@pigment-css/vite-plugin";
import { dsTheme } from "@company/design-system/theme";

export default defineConfig({
  plugins: [
    pigment({
      transformLibraries: ["@mui/material"],
      theme: dsTheme,
    }),
  ],
});
```

#### Next.js (App Router)

```ts
// next.config.mjs
import { withPigment } from "@pigment-css/nextjs-plugin";
import { dsTheme } from "@company/design-system/theme";

const nextConfig = {
  /* ... */
};

export default withPigment(nextConfig, {
  transformLibraries: ["@mui/material"],
  theme: dsTheme,
});
```

Notes:

- Pigment tooling runs in Node. Ensure `@company/design-system/theme` is importable from config (built JS, not browser-only).
- Known constraint from MUI docs: pnpm may have issues with the Vite plugin; prefer npm or yarn if it bites.

---

## 5) Dockview: per-panel theming without pollution (shell-ui)

### Contract for MF panel roots

Shell provides MF apps:

- `tenant: TenantId`
- `mode: Mode`
- `portalContainer: HTMLElement` (the panel root element)

MF apps must render under a scoped class on the panel root:

- `.ds-${schemeName(tenant, mode)}`

### Panel wrapper (shell-owned or in design-system)

```tsx
import * as React from "react";
import { ThemeProvider } from "@mui/material/styles";
import { DefaultPropsProvider } from "@mui/material/DefaultPropsProvider";
import {
  dsTheme,
  schemeName,
  type TenantId,
  type Mode,
} from "@company/design-system/theme";

type Props = {
  tenant: TenantId;
  mode: Mode;
  portalContainer: HTMLElement;
  children: React.ReactNode;
};

export const PanelThemeRoot = ({
  tenant,
  mode,
  portalContainer,
  children,
}: Props) => {
  const scheme = schemeName(tenant, mode);

  return (
    <ThemeProvider theme={dsTheme}>
      <DefaultPropsProvider
        value={{
          MuiPopover: { container: portalContainer },
          MuiPopper: { container: portalContainer },
          MuiModal: { container: portalContainer },
        }}
      >
        <div
          className={`ds-${scheme}`}
          style={{ height: "100%", width: "100%" }}
        >
          {children}
        </div>
      </DefaultPropsProvider>
    </ThemeProvider>
  );
};
```

Rule: MF apps must NOT set portal containers themselves globally; they should accept `portalContainer` from shell.

---

## 6) MF rules (Module Federation)

### Shared singletons (required)

Share as singletons (versions aligned):

- `react`, `react-dom`
- `@mui/material`, `@mui/system`
- `@mui/material-pigment-css`
- `@pigment-css/react`
- `@company/design-system`

### MF apps must be “theme-passive”

- Do not import global stylesheets other than what shell mandates.
- Do not mount global providers that mutate mode at `<html>`.
- Always render inside the panel wrapper (or equivalent), using tenant+mode from shell.

---

## 7) Pigment authoring rules (what AI/devs must do)

### Do

- Prefer `styled` from `@mui/material-pigment-css`.
- Prefer `theme.vars.*` for any mode/tenant-sensitive styling.
- Use `variants` when props are known at build time.
- For runtime styling, push values into CSS vars:
  - `<div style={{ '--accent': value } as React.CSSProperties } sx={{ color: 'var(--accent)' }} />`

### Don’t

- `sx={{ color: someState }}` (extraction error risk)
- `styleOverrides` that use `ownerState` callbacks (unsupported pattern; use variants)
- Code that branches on runtime theme for light/dark (Pigment runtime theme is precompiled; use `theme.vars`)

---

## 8) Markdown gotcha (for docs authors)

If you wrap this entire file in a fenced code block, and you also include fenced code blocks inside it, you must use a longer outer fence (e.g. 4 backticks) so the inner triple-backticks don’t terminate the outer block.
