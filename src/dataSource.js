/**
 * Talent cost is stored in dollars in both modes. Local sample mode still
 * shows that cost as a multiplier of the baseline. The API shows dollars.
 * Burn uses the clamped talent-cost factor, not this display choice.
 */
export function talentCostShowsDollars(dataSource) {
  switch (dataSource) {
    case 'local':
      return false;
    case 'api':
      return true;
    default: {
      const neverSource = dataSource;
      throw new Error(`Unknown data source: ${String(neverSource)}`);
    }
  }
}
