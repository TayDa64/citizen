import { describe, expect, test } from 'vitest';
import { talentCostMultipliesBurn, talentCostShowsDollars } from './dataSource';

describe('talent cost burn coupling', () => {
  test('is on for local samples and off for the API', () => {
    expect(talentCostMultipliesBurn('local')).toBe(true);
    expect(talentCostMultipliesBurn('api')).toBe(false);
  });

  test('rejects an unknown source instead of guessing', () => {
    expect(() => talentCostMultipliesBurn('remote')).toThrow(/unknown data source/i);
  });
});

describe('talent cost display', () => {
  test('uses a multiplier locally and dollars for API data', () => {
    expect(talentCostShowsDollars('local')).toBe(false);
    expect(talentCostShowsDollars('api')).toBe(true);
  });
});
