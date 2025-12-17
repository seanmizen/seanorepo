# Refactoring Plan: TypeScript + ARIA Compliance + Bulletproof React

## Overview
Migrate seanmizen.com from JavaScript to TypeScript, implement full ARIA compliance, and restructure using Bulletproof React patterns.

## Goals
1. Full TypeScript conversion with strict type checking
2. ARIA-compliant components (keyboard navigation, screen readers, focus management)
3. Zero-dependency custom accordion/collapsible (replacing react-collapsible)
4. Bulletproof React structure
5. Preserve git history where possible (git mv)

## New Project Structure (Bulletproof React)

```
src/
├── app/
│   ├── routes/           # Route components
│   │   ├── home.tsx
│   │   ├── apps.tsx
│   │   └── glasto.tsx
│   ├── app.tsx           # Main app component
│   ├── provider.tsx      # Global providers wrapper
│   └── router.tsx        # Router configuration
├── assets/               # Static files (images, fonts)
├── components/           # Shared components
│   ├── accordion/
│   │   ├── accordion.tsx
│   │   ├── accordion.module.css
│   │   └── index.ts
│   ├── code/
│   ├── theme-toggle/
│   └── index.ts          # Barrel export
├── features/             # Feature modules
│   ├── github/
│   │   ├── components/
│   │   ├── github.tsx
│   │   └── index.ts
│   ├── projects/
│   ├── donate/
│   ├── xmas/
│   ├── glasto/
│   └── this-page/
├── hooks/                # Shared hooks
│   ├── use-key-sequence.ts
│   ├── use-theme.ts
│   └── index.ts
├── lib/                  # Configured libraries
│   └── router.ts
├── providers/            # Context providers
│   ├── theme.tsx
│   └── index.ts
├── types/                # Shared types
│   ├── theme.ts
│   ├── navigation.ts
│   └── index.ts
├── utils/                # Utility functions
│   ├── date.ts
│   └── index.ts
├── index.css
└── index.tsx
```

## Implementation Steps

### Phase 1: Setup & Configuration
- [ ] Add TypeScript dependencies (@types/react, @types/react-dom, typescript)
- [ ] Create tsconfig.json with strict mode
- [ ] Update rsbuild.config to handle .tsx files
- [ ] Create types/ directory with base types

### Phase 2: Core Infrastructure
- [ ] Convert providers/Theme.jsx → providers/theme.tsx
- [ ] Create types/theme.ts for theme types
- [ ] Convert hooks/useKeySequence.jsx → hooks/use-key-sequence.ts
- [ ] Create app/provider.tsx (wrapper for all providers)
- [ ] Create app/router.tsx (router configuration)

### Phase 3: Build Custom ARIA-Compliant Accordion
- [ ] Create components/accordion/accordion.tsx
  - Keyboard navigation (Enter, Space, Arrow keys)
  - Focus management
  - aria-expanded, aria-controls, aria-labelledby
  - role="region" for content
  - Proper heading structure
- [ ] Replace react-collapsible throughout codebase
- [ ] Remove react-collapsible dependency

### Phase 4: Convert Shared Components
- [ ] components/Code → components/code/code.tsx
- [ ] components/HomeLi → components/accordion-item/ (merge with accordion)
- [ ] components/HomeLink → components/home-link/home-link.tsx
- [ ] components/LastUpdated → components/last-updated/last-updated.tsx
- [ ] components/Spacer → components/spacer/spacer.tsx
- [ ] components/ThemeToggle → components/theme-toggle/theme-toggle.tsx
- [ ] components/SSHModal → components/ssh-modal/ssh-modal.tsx
- [ ] components/ShaderSean → components/shader-sean/shader-sean.tsx
- [ ] Add ARIA attributes to all interactive elements
- [ ] Ensure keyboard navigation works everywhere

### Phase 5: Convert Features
- [ ] features/Donate → features/donate/donate.tsx
- [ ] features/Github → features/github/github.tsx
- [ ] features/Projects → features/projects/projects.tsx
- [ ] features/ThisPage → features/this-page/this-page.tsx
- [ ] features/Xmas → features/xmas/xmas.tsx
- [ ] features/Glasto → features/glasto/glasto.tsx
- [ ] Each feature gets proper TypeScript types
- [ ] Add barrel exports (index.ts) for each feature

### Phase 6: Convert Pages/Routes
- [ ] pages/Home → app/routes/home.tsx
- [ ] pages/Apps → app/routes/apps.tsx
- [ ] Add proper ARIA landmarks (main, nav, etc.)
- [ ] Ensure proper heading hierarchy (h1 → h2 → h3)

### Phase 7: Convert App Entry
- [ ] App.jsx → app/app.tsx
- [ ] index.jsx → index.tsx
- [ ] Update all imports to use barrel exports

### Phase 8: ARIA Compliance Audit
- [ ] All interactive elements have proper roles
- [ ] All images have alt text
- [ ] All forms have labels
- [ ] All buttons have accessible names
- [ ] Focus indicators visible
- [ ] Skip links for navigation
- [ ] Proper heading hierarchy
- [ ] Color contrast meets WCAG AA
- [ ] Keyboard navigation works throughout
- [ ] Screen reader testing

### Phase 9: Cleanup
- [ ] Remove all .jsx files
- [ ] Remove all .js barrel exports, replace with .ts
- [ ] Update package.json scripts if needed
- [ ] Remove react-collapsible from dependencies
- [ ] Verify all git mv operations preserved history

## Key Technical Decisions

### Custom Accordion Component
```typescript
// Zero-dependency, fully ARIA-compliant
interface AccordionProps {
  trigger: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
}

// Features:
// - Keyboard: Enter/Space to toggle, Tab to navigate
// - ARIA: aria-expanded, aria-controls, aria-labelledby
// - Focus management
// - Smooth animations with CSS
```

### TypeScript Strict Mode
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

### Barrel Exports Pattern
```typescript
// components/index.ts
export { Accordion } from './accordion';
export { Code } from './code';
export { ThemeToggle } from './theme-toggle';
// Named exports only, no default exports
```

### ARIA Best Practices
- Use semantic HTML first (button, nav, main, article)
- Add ARIA only when semantic HTML insufficient
- Ensure all interactive elements keyboard accessible
- Manage focus properly (modals, accordions)
- Provide skip links for keyboard users
- Test with screen readers (NVDA, JAWS, VoiceOver)

## Migration Strategy

1. **Incremental**: Convert one module at a time
2. **Test continuously**: Ensure app works after each phase
3. **Git history**: Use `git mv` for file renames when possible
4. **Coexistence**: .tsx and .jsx can coexist during migration
5. **Final squash**: All changes squashed into one commit at end

## Testing Checklist

### Keyboard Navigation
- [ ] Tab through all interactive elements
- [ ] Enter/Space activates buttons and links
- [ ] Arrow keys work in accordions
- [ ] Escape closes modals
- [ ] Focus visible at all times
- [ ] No keyboard traps

### Screen Reader
- [ ] All content announced properly
- [ ] Interactive elements have clear labels
- [ ] State changes announced (accordion open/close)
- [ ] Form errors announced
- [ ] Landmarks properly identified

### Visual
- [ ] Focus indicators visible
- [ ] Color contrast meets WCAG AA (4.5:1 text, 3:1 UI)
- [ ] No information conveyed by color alone
- [ ] Text resizable to 200% without loss of functionality

## Notes

- Keep existing CSS modules where possible
- Preserve all functionality during migration
- Document any breaking changes
- Update README with TypeScript setup instructions
- Consider adding ESLint with TypeScript rules
- Consider adding Prettier for consistent formatting

## Timeline Estimate

- Phase 1: 30 minutes
- Phase 2: 1 hour
- Phase 3: 2 hours (custom accordion is critical)
- Phase 4: 2 hours
- Phase 5: 2 hours
- Phase 6: 1 hour
- Phase 7: 30 minutes
- Phase 8: 2 hours (thorough testing)
- Phase 9: 30 minutes

**Total: ~11.5 hours**

## Success Criteria

1. ✅ All files converted to TypeScript
2. ✅ No TypeScript errors with strict mode
3. ✅ Zero external dependencies for UI components (except React)
4. ✅ Full keyboard navigation support
5. ✅ WCAG 2.1 AA compliance
6. ✅ All tests pass
7. ✅ Git history preserved where possible
8. ✅ Bulletproof React structure implemented

---

## Performance Benchmarks

### BEFORE Refactoring (JavaScript + react-collapsible)

**Build Metrics:**
- Build time: 0.49s
- Total bundle size: 1022.8 kB (458.1 kB gzipped)
- Dist directory: 1.1 MB

**Bundle Breakdown:**
- `index.html`: 2.3 kB (0.93 kB gzipped)
- `index.css`: 7.0 kB (2.3 kB gzipped)
- `index.js`: 29.6 kB (11.1 kB gzipped)
- `lib-router.js`: 31.9 kB (11.7 kB gzipped)
- `lib-react.js`: 189.8 kB (59.9 kB gzipped)
- `623.js` (three.js): 519.9 kB (130.1 kB gzipped)
- `IMG_4011_crop2.jpeg`: 226.8 kB
- `favicon.ico`: 15.4 kB

**Source Code:**
- Total files: 60 (.jsx, .js, .css)
- Lines of code: 2,070 (JS/JSX only)

**Dependencies:**
- Production: 8 packages
  - react, react-dom, react-router-dom
  - react-collapsible (to be removed)
  - three, three-stdlib, stats.js
  - number-to-words
- Development: 3 packages
  - @rsbuild/core, @rsbuild/plugin-react
  - rsbuild-plugin-glsl

### AFTER Refactoring (TypeScript + custom accordion)

_To be measured after completion_

**Expected improvements:**
- Remove react-collapsible dependency (~10-15 kB)
- Better tree-shaking with TypeScript
- Improved type safety (zero runtime cost)
- Potentially faster build with better caching
