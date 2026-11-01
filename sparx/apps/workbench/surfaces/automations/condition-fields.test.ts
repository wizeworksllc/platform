import { GOAL_FIELD_PATHS, RESOLVED_FIELD_PATHS } from '@wizeworks/automation-schemas';
import { describe, expect, it } from 'vitest';
import {
  CONDITION_FIELDS,
  conditionFieldItems,
  conditionFieldLabel,
  conditionFieldMatches,
  operatorsFor,
} from './condition-fields';

// The condition picker speaks in an owner's words and offers only details the
// server really fills (sparx persona issue 158). It offered raw code names, three
// of which no resolver ever filled, and none of the details a campaign's own goal
// checks ("they booked", "they paid", "they accepted the quote").
//
// What the server fills, and what the goals check, are the platform's lists
// (@wizeworks/automation-schemas), which its own test keeps true to the sources.

describe('the details a condition can check', () => {
  it('offers only details the server fills, so a rule can come true', () => {
    const resolved = new Set(RESOLVED_FIELD_PATHS);
    const dead = CONDITION_FIELDS.map((f) => f.path).filter((p) => !resolved.has(p));
    expect(dead, 'offered, but no resolver fills it').toEqual([]);
  });

  it('offers every detail a campaign goal checks', () => {
    const offered = new Set(CONDITION_FIELDS.map((f) => f.path));
    const missing = GOAL_FIELD_PATHS.filter((p) => !offered.has(p));
    expect(missing, 'a library goal checks it, and the picker cannot show it').toEqual([]);
  });

  it('names each detail in words, not code', () => {
    for (const f of CONDITION_FIELDS) {
      const label = conditionFieldLabel(f.path);
      expect(label, f.path).not.toMatch(/\.|[a-z][A-Z]|_/);
      for (const c of f.choices ?? []) expect(c.label, `${f.path} = ${c.value}`).not.toMatch(/_/);
    }
    expect(conditionFieldLabel('booking.status')).toBe('Booking · Status');
  });

  it('keeps a stored detail it does not offer, under its own name', () => {
    const items = conditionFieldItems('deal.search');
    expect(items.at(-1)).toEqual({ value: 'deal.search', label: 'deal.search' });
    expect(
      conditionFieldItems('booking.status').filter((i) => i.value === 'booking.status')
    ).toHaveLength(1);
  });

  it('finds a detail by the words an owner types for the goal they want', () => {
    const found = (query: string) =>
      conditionFieldItems('')
        .filter((item) => conditionFieldMatches(item, query))
        .map((item) => item.value);
    expect(found('paid')).toContain('order.paymentStatus');
    expect(found('booked')).toContain('booking.status');
    expect(found('book')).toContain('booking.status');
    expect(found('confirmed')).toContain('booking.status');
    expect(found('accepted')).toContain('quote.stageName');
    expect(found('order payment')).toEqual(['order.paymentStatus']);
    expect(found('zebra')).toEqual([]);
  });

  it('offers comparisons that fit, and keeps a stored one that does not', () => {
    expect(operatorsFor('booking.status', 'eq')).not.toContain('gt');
    expect(operatorsFor('booking.status', 'gt')).toContain('gt');
    expect(operatorsFor('customer.hasOrdered', 'eq')).toEqual(['eq']);
  });
});
