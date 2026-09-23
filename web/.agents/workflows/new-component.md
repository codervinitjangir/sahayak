# Workflow: /new-component <name>

Use this workflow to scaffold a shared design-system UI component with tests.

## Steps
1. Create component file: `src/components/<Name>.tsx`.
2. Define interface `<Name>Props`.
3. Adhere to design system tokens (`#0F766E` primary, `#B91C1C` danger, `#15803D` success, `#B45309` warning).
4. Enforce WCAG 2.1 AA accessibility:
   - Provide keyboard focus rings (`focus:ring-2`).
   - Use semantic elements.
   - For status indicators, combine icons with text.
5. Create corresponding component test under `tests/components/<Name>.test.tsx`.
6. Run `npm test` to verify.
