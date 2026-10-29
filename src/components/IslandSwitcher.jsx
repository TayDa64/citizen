import {
  PLAYER_ROLE_CAMPAIGN,
  PLAYER_ROLE_COMPANY_OPS,
  roleLabel,
} from '../playerRole';

/**
 * Dual-island switcher. Same campaign/sim underneath — only the desk changes.
 */
export default function IslandSwitcher({ role, onChange }) {
  return (
    <nav className="island-switcher" aria-label="Gameplay island" data-testid="island-switcher">
      <span className="island-switcher__label">Island</span>
      <div className="island-switcher__tabs" role="group" aria-label="Switch gameplay island">
        <button
          type="button"
          data-testid="island-company-ops"
          aria-pressed={role === PLAYER_ROLE_COMPANY_OPS}
          className={role === PLAYER_ROLE_COMPANY_OPS ? 'is-active' : undefined}
          onClick={() => onChange?.(PLAYER_ROLE_COMPANY_OPS)}
        >
          {roleLabel(PLAYER_ROLE_COMPANY_OPS)}
        </button>
        <button
          type="button"
          data-testid="island-campaign"
          aria-pressed={role === PLAYER_ROLE_CAMPAIGN}
          className={role === PLAYER_ROLE_CAMPAIGN ? 'is-active' : undefined}
          onClick={() => onChange?.(PLAYER_ROLE_CAMPAIGN)}
        >
          {roleLabel(PLAYER_ROLE_CAMPAIGN)}
        </button>
      </div>
    </nav>
  );
}
