import {
  VOTER_SUPPORT_FLOOR,
  defaultPolitics,
  formatSurvivalStatus,
  formatVoterSupport,
} from '../politicalObjectives';
import { computeCivicFromTax } from '../civicFeedback';

/**
 * Single aggregate politics / survival strip (campaign island).
 * No fake demographic popularity — one voterSupport meter + floor 0.25.
 */
export default function PoliticsMeter({ state }) {
  const civic = state?.civic ?? computeCivicFromTax(state?.taxRate);
  const politics = state?.politics ?? defaultPolitics(civic, state?.company?.hype);
  const support = Number(politics.voterSupport);
  const floor = Number(politics.survivalFloor ?? VOTER_SUPPORT_FLOOR);
  const floorPct = Math.round(floor * 100);
  const supportPct = Number.isFinite(support) ? Math.max(0, Math.min(100, Math.round(support * 100))) : 0;
  const belowFloor = Number.isFinite(support) && support < floor;
  const status = formatSurvivalStatus(politics.survivalStatus);

  return (
    <section
      className="politics-meter"
      aria-labelledby="politics-meter-heading"
      data-testid="politics-meter"
    >
      <h3 id="politics-meter-heading">Politics &amp; survival</h3>
      <p className="politics-meter__blurb">
        Voter support = ½ budget headroom + ½ company hype. Advance Month below the{' '}
        <span data-testid="politics-survival-floor-value">{floorPct}%</span> floor ousts the incumbent
        (recoverable later). Not a demographic list.
      </p>
      <div
        className={`politics-meter__bar${belowFloor ? ' politics-meter__bar--danger' : ''}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={supportPct}
        aria-valuetext={`${formatVoterSupport(support)}, ${status}`}
        data-testid="politics-voter-support-meter"
      >
        <div
          className="politics-meter__fill"
          style={{ width: `${supportPct}%` }}
          data-testid="politics-voter-support-fill"
        />
        <div
          className="politics-meter__floor"
          style={{ left: `${floorPct}%` }}
          title={`Survival floor ${floorPct}%`}
          data-testid="politics-survival-floor-marker"
        />
      </div>
      <dl className="politics-meter__stats">
        <div>
          <dt>Voter support</dt>
          <dd>
            <span data-testid="politics-voter-support-value">
              {formatVoterSupport(support)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Survival</dt>
          <dd>
            <span data-testid="politics-survival-status-value">{status}</span>
          </dd>
        </div>
        <div>
          <dt>Survival floor</dt>
          <dd>
            <span data-testid="politics-survival-floor-label">{floorPct}%</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
