// The extra fields every staff user carries, as Better Auth declares them.
//
// One list for both sides: the server passes it to `user.additionalFields`, and
// the browser client passes it to `inferAdditionalFields`, so `useSession()`
// returns them typed. The client used to infer them from the server's own type,
// which a frontend cannot import without the auth server and the database.

export const USER_ADDITIONAL_FIELDS = {
  tenantId: {
    type: 'string',
    required: true,
    input: false,
  },
  role: {
    type: 'string',
    required: false,
    defaultValue: 'editor',
    input: false,
  },
  // Which product this login belongs to. Declared here so the value is
  // SELECTED on reads — the session carries it, which is what lets an
  // invitation check that the person accepting belongs to the brand that
  // owns the tenant.
  //
  // `input: false` for the same reason as the two above: it is never
  // accepted from a client payload. It is not `required`, because the
  // guarantee lives one layer down — brand-scoped-prisma.ts stamps it on
  // every create, so a payload that omits it still lands correctly, and a
  // payload that could contradict it never reaches the database.
  platformBrand: {
    type: 'string',
    required: false,
    input: false,
  },
} as const;
