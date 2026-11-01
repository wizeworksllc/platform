// The runtime body validator moved to the neutral @wizeworksllc/field-schema engine
// (docs/143 §3). CMS consumers keep importing `bodyValidatorFor` / `validateBody`
// / `BodyValidationResult` from '@wizeworksllc/cms-schemas' — they resolve here to the
// shared engine unchanged. `ContentTypeSchema` (the CMS name) IS the neutral
// `FieldSchema`, so the validator accepts it directly.

export { bodyValidatorFor, validateBody } from '@wizeworksllc/field-schema';
export type { BodyValidationResult } from '@wizeworksllc/field-schema';
