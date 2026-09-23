# Workflow: /new-page <role>/<name>

Use this workflow to scaffold a role-scoped view component.

## Roles
- `owner`: Stranded vehicle owner flows.
- `partner`: Service provider flows.
- `admin`: Operations center flows.

## Steps
1. Create page component at `src/pages/<role>/<Name>Page.tsx`.
2. Add the route entry in `src/app/routes.tsx` wrapped in the corresponding `<RequireRole role="<role>">` guard.
3. Use hooks from `src/features/<feature>/hooks.ts` for data loading and mutations.
4. Implement emergency-first UX principles:
   - Clear loading and empty states.
   - Clear visual feedback on actions (toasts/status updates).
   - High contrast, mobile-friendly layouts.
