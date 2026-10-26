/**
 * Talent cost is dollars on the API and a dimensionless multiplier in local
 * sample mode. Burn uses talentMultiplier, not this display choice.
 * APPLY_TALENT_COST_TO_BURN scales burn by the talent-cost factor, clamped to 0.10×–3.00×.
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
