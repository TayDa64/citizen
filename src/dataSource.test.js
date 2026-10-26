import { describe, expect, test } from 'vitest';
import { talentCostShowsDollars } from './dataSource';

describe('talent cost display', () => {
  test('uses a multiplier locally and dollars for API data', () => {
    expect(talentCostShowsDollars('local')).toBe(false);
    expect(talentCostShowsDollars('api')).toBe(true);
  });

  test('rejects an unknown source instead of guessing', () => {
    expect(() => talentCostShowsDollars('remote')).toThrow(/unknown data source/i);
  });
});
