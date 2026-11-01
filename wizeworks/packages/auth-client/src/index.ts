// @wizeworksllc/auth-client — what a frontend needs from staff auth, with no server
// and no database behind it: the browser client (./client), the role and access
// vocabularies, the MCP scope list, the slug helpers, and the shared user fields.
// @wizeworksllc/auth re-exports each of these, so platform imports do not change.

export type { SignUpAcquisition } from './sign-up-acquisition';
export { USER_ADDITIONAL_FIELDS } from './user-fields';
