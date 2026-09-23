# Workflow: /new-feature <name>

Use this workflow to scaffold a domain feature under `src/features/<name>/`.

## Steps
1. Create domain feature directory: `src/features/<name>/`.
2. Create feature files:
   - `types.ts`: Domain models and request/response shapes.
   - `hooks.ts`: React Query hooks (`use<Name>`, `useCreate<Name>`, etc.).
   - `components/`: Feature-specific sub-components.
   - `index.ts`: Barrel export.
3. Wire the hooks to the typed API service in `src/services/`.
4. Ensure optimistic updates or invalidations are configured on mutations.
5. Export clean public API from `index.ts`.
