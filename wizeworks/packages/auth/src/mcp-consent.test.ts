// Approving an AI tool on the consent screen has to reach the tool.
//
// Measured 2026-10-31 on a local run: every "Authorize" click answered "This
// connection could not be completed". The provider finishes an approval inside
// its authorize step, which refuses to run without a request object, and a
// call from server code carries none. Handed one, the call answers with a
// Response unless told otherwise, so the address came back empty instead.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const oauth2Consent = vi.fn();
vi.mock('./server', () => ({
  auth: { api: { oauth2Consent }, options: { baseURL: 'https://app.example.test' } },
}));
vi.mock('./mcp-connections', () => ({ getRegisteredMcpClient: vi.fn() }));

const { submitMcpConsent } = await import('./mcp-consent');

describe('submitMcpConsent', () => {
  beforeEach(() => {
    oauth2Consent.mockReset();
    oauth2Consent.mockResolvedValue({
      redirect: true,
      url: 'https://assistant.example.test/cb?code=c',
    });
  });

  it("returns the provider's redirect to the assistant", async () => {
    const next = await submitMcpConsent({
      oauthQuery: 'client_id=a&sig=s',
      accept: true,
      scope: 'read:crm',
      headers: new Headers({ cookie: 'session=1' }),
    });
    expect(next).toBe('https://assistant.example.test/cb?code=c');
  });

  it('gives the provider a request to finish on, and asks for a value back', async () => {
    await submitMcpConsent({
      oauthQuery: 'client_id=a&sig=s',
      accept: true,
      scope: 'read:crm',
      headers: new Headers({ cookie: 'session=1' }),
    });

    const call = oauth2Consent.mock.calls[0]![0] as {
      request?: Request;
      headers: Headers;
      asResponse?: boolean;
      body: Record<string, unknown>;
    };
    expect(call.request).toBeInstanceOf(Request);
    expect(call.request!.method).toBe('POST');
    expect(call.request!.url).toBe('https://app.example.test/api/auth/oauth2/consent');
    expect(call.request!.headers.get('cookie')).toBe('session=1');
    expect(call.headers.get('accept')).toBe('application/json');
    expect(call.asResponse).toBe(false);
    expect(call.body).toEqual({
      accept: true,
      oauth_query: 'client_id=a&sig=s',
      scope: 'read:crm',
    });
  });

  it('sends no scope with a denial', async () => {
    await submitMcpConsent({
      oauthQuery: 'client_id=a&sig=s',
      accept: false,
      scope: 'read:crm',
      headers: new Headers(),
    });
    expect((oauth2Consent.mock.calls[0]![0] as { body: object }).body).toEqual({
      accept: false,
      oauth_query: 'client_id=a&sig=s',
    });
  });
});
