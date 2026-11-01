// A SIGN-IN EMAIL BELONGS TO NO BUSINESS, AND STILL HAS TO ARRIVE.
//
// Measured 2026-10-31 on a local run: "Email me a code" said "Check your email",
// the event reached this worker, and no email was ever sent. The sign-in code
// and the sign-in link go to an address that may have no account yet, so auth
// publishes them with an empty tenant id. The envelope schema required a
// non-empty one, so `parseEvent` returned null, the broker handler logged one
// warning and acked, and the person waited for a code that never came.
//
// With no business to read the brand from, the send says which product it is
// for, so a Piggles code does not arrive dressed as sparx.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';

const findUnique = vi.fn();
const send = vi.fn();
const renderTemplate = vi.fn();
const resolveEmailBrand = vi.fn();
const signingDomainFor = vi.fn();
const recordAccepted = vi.fn();

vi.mock('@wizeworksllc/db', () => ({ prisma: { tenant: { findUnique } } }));
vi.mock('@wizeworksllc/email', () => ({
  defaultBrand: {},
  getEmailProvider: () => ({ send }),
  MailgunParameterError: class extends Error {},
  PostalParameterError: class extends Error {},
  renderTemplate,
  senderDomainOf: () => 'sparx.email',
}));
vi.mock('@wizeworksllc/email-platform', () => ({
  analyticsService: { recordAccepted },
  brandService: { resolveEmailBrand },
  domainService: { signingDomainFor },
  settingsService: { senderHeaders: vi.fn() },
}));
vi.mock('@wizeworksllc/links/server', () => ({ appOrigin: () => 'https://app.example.test' }));

const { handle, parseEvent } = await import('../handler.js');

const logger = pino({ level: 'silent' });

function signInCode(platformBrand?: string) {
  return {
    type: 'email.send',
    tenantId: '',
    actorId: null,
    occurredAt: '2026-10-31T19:45:07.897Z',
    data: {
      to: 'new-person@example.test',
      template: 'login-otp',
      props: { code: '123456', expiresInMinutes: 5 },
      ...(platformBrand ? { platformBrand } : {}),
    },
  };
}

describe('an email that belongs to no business', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue({ id: 'msg-1' });
    renderTemplate.mockImplementation((input: { to: string }, opts: { brand: unknown }) =>
      Promise.resolve({ to: input.to, from: 'x', subject: 's', html: 'h', text: 't', opts })
    );
    recordAccepted.mockResolvedValue(undefined);
  });

  it('passes the delivery gate with an empty tenant id', () => {
    expect(parseEvent(signInCode())).not.toBeNull();
    expect(
      parseEvent({
        ...signInCode(),
        data: {
          ...signInCode().data,
          template: 'magic-link',
          props: { magicUrl: 'https://x.test/a', expiresInMinutes: 15 },
        },
      })
    ).not.toBeNull();
  });

  it('is sent, without looking up a business that does not exist', async () => {
    const event = parseEvent(signInCode('sparx'));
    expect(event).not.toBeNull();

    const outcome = await handle(event!, logger);

    expect(outcome.status).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    expect(findUnique).not.toHaveBeenCalled();
    expect(resolveEmailBrand).not.toHaveBeenCalled();
    expect(signingDomainFor).not.toHaveBeenCalled();
    expect(recordAccepted).not.toHaveBeenCalled();
    const variables = send.mock.calls[0]![0].variables as Record<string, string>;
    expect(variables).not.toHaveProperty('tenant_id');
  });

  it('speaks as the product it was sent for', async () => {
    await handle(parseEvent(signInCode('piggles'))!, logger);

    const opts = renderTemplate.mock.calls[0]![1] as { brand: { platform: { name: string } } };
    expect(opts.brand.platform.name.toLowerCase()).toContain('piggles');
  });
});
