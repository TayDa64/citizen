import {
  PLAYER_ROLE_CAMPAIGN,
  PLAYER_ROLE_COMPANY_OPS,
  roleBlurb,
  roleLabel,
} from '../playerRole';

/**
 * Entry gate before the main desk. Role is a lens — not a separate sim.
 */
export default function RoleSelect({ onSelect }) {
  return (
    <section className="role-select" aria-labelledby="role-select-heading" data-testid="role-select">
      <h2 id="role-select-heading">Choose your role</h2>
      <p className="role-select__lede">
        Citizen runs one shared backend. Pick a lens to start — you can switch islands later.
      </p>
      <div className="role-select__choices">
        <button
          type="button"
          className="role-select__choice"
          data-testid="role-company-ops"
          aria-label={`Enter as ${roleLabel(PLAYER_ROLE_COMPANY_OPS)}`}
          onClick={() => onSelect?.(PLAYER_ROLE_COMPANY_OPS)}
        >
          <strong>{roleLabel(PLAYER_ROLE_COMPANY_OPS)}</strong>
          <span>{roleBlurb(PLAYER_ROLE_COMPANY_OPS)}</span>
        </button>
        <button
          type="button"
          className="role-select__choice"
          data-testid="role-campaign"
          aria-label={`Enter as ${roleLabel(PLAYER_ROLE_CAMPAIGN)}`}
          onClick={() => onSelect?.(PLAYER_ROLE_CAMPAIGN)}
        >
          <strong>{roleLabel(PLAYER_ROLE_CAMPAIGN)}</strong>
          <span>{roleBlurb(PLAYER_ROLE_CAMPAIGN)}</span>
        </button>
      </div>
    </section>
  );
}
