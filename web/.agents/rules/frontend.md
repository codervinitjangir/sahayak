# Rule: Frontend Conventions & Component Patterns

## Core Stack
- **Framework**: React 18+ (Functional components only, strictly no class components).
- **Language**: TypeScript with strict mode enabled (`noImplicitAny: true`, `strictNullChecks: true`).
- **State Management**:
  - **Server State**: TanStack React Query (`@tanstack/react-query`). Use hooks in `src/features/<feature>/hooks.ts`. Never cache server data in custom React contexts or ad-hoc `useState` if it can be fetched via React Query.
  - **Client State**: Local state via React hooks (`useState`, `useReducer`). Global client/session state via lightweight Context (`AuthProvider`).
- **Routing**: React Router DOM v6 with role-based route guards (`src/app/RouteGuards.tsx`).

## Component Structure & Standards
1. **Directory Placement**:
   - Atomic & shared UI components: `src/components/` (e.g. `Button`, `StatusBadge`, `ServiceCard`, `VehicleSelector`, `LocationPicker`).
   - Domain feature logic & feature-specific widgets: `src/features/<domain>/`.
   - Route/Page components: `src/pages/<role>/` (`owner/`, `partner/`, `admin/`).
2. **Naming Conventions**:
   - Components: `PascalCase.tsx`
   - Hooks: `useCamelCase.ts`
   - Utilities & Services: `camelCase.ts`
   - Types & Interfaces: `PascalCase`
3. **Props Contract**:
   - Always define an explicit TypeScript `interface` or `type` for component props.
   - Extend standard HTML attributes where appropriate (e.g., `ButtonHTMLAttributes<HTMLButtonElement>`).
4. **Performance & Clean Code**:
   - Destructure props directly in the function signature.
   - Use `useCallback` / `useMemo` where expensive computations or unneeded re-renders occur.
   - Keep components focused: A component should do one job well.
