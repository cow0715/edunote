# Original question regions — 2026-10-23

## Implementation
- Retain chart questions in bank parsing and request original page/region metadata. Both queue and legacy bank imports persist original PNG regions in private answer-sheets storage.
- Book native image audit supplies region metadata from audited source references; publication attaches the corresponding original PDF images to bank questions. Published-job retries can resume image persistence without paid reparsing.
- Added exam_bank_question.source_images JSONB migration. Applied only to development project otlyfjciikngdoazjusq after the user explicitly asked the agent to apply it. Production not changed.
- Teacher image URL endpoint checks question/bank ownership and signs only the saved path at the requested index.
- Share image access checks the share token, share access and class enrollment before accessing the preserved PDF. Existing processed questions are recropped from native question-number/next-question geometry with validated prior bounds as fallback; the derived image is cached. Missing images can be requested by question ID. Missing/unreadable PDFs retain the previous stored image rather than inventing visual data.
- Share compact images use natural proportional height instead of a 320px cap.

## Verification without paid AI
- Unit tests cover chart retention, coordinate validation, column/next-question boundaries, duplicate-number ambiguity, audited book references, actual PDF raster/crop/storage pixels, access control, caching and missing-source fallback, plus real React image rendering.
- Used the actual development DB and private Storage: created two synthetic bank questions (past exam/textbook) and a synthetic class/student/week/answer with an intentionally full-page original. Both cards loaded 457x589 crops. Share loaded the cropped 457x589 region instead of the full page and reused it on the next request.
- Browser checked 375px share layout (no horizontal overflow) and dark/light display. Saved proof images in this chat visualization directory: bank-source-region-qa.png and share-source-region-qa.png.
- Removed both fixture banks, the synthetic class/student/week/questions and five Storage objects. SQL confirmed zero fixture rows remain.
- Full required validation log: .next/visual-source-release-check.log.

## Limits
- No paid parser/model call was executed. Real model accuracy across arbitrary PDFs is not asserted.
- Existing bank chart questions previously skipped are not reconstructed by this change; fresh imports use the updated parser. Already-published legacy books without stored audited region references need a separate migration/recovery pass before they acquire images.
- Existing share recovery needs the preserved original PDF plus a known page; uncertain geometry retains the original/validated previous region.
- No commit, main push or deployment was requested in this turn, so changes remain in the existing worktree.
