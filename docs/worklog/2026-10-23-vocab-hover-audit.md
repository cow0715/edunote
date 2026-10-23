# Vocabulary hover verification — 2026-10-23

- Tested localhost:3110 against the actual development Supabase project otlyfjciikngdoazjusq with the authenticated development teacher.
- Created two disposable collections (__HOVER_QA_20261023_A/B) with six synthetic vocabulary items; no AI generation/enrichment was invoked.
- Verified collection selection and inactive hover in both themes, detail rendering, word-sort direction control, and row hover.
- Replaced faint blue row hover with --control-bg (light #F2F4F6 / dark #24242B). Replaced divide utilities leaving bright dark-mode separators with explicit theme-border sibling rules.
- Browser computed styles confirmed dark row and collection hover rgb(36,36,43), light rgb(242,244,246), and dark row separators rgb(52,52,62).
- Deleted exactly the two owned fixture collections and six items; SQL verified zero fixture rows remain. Restored original light theme.
- Screenshots: vocab-hover-light.png / vocab-hover-dark.png in this chat visualization directory.
- Validation: npm run check (typecheck, lint, unit tests); production build verified through Vercel after main push.
