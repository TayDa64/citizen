/**
 * Shown when a server-backed turn commit fails. The screen keeps the last
 * state the campaign confirmed; this alert says so and offers Retry, which
 * re-reads the campaign before sending the unsaved commands again.
 * role="alert": further turn commands wait until the player retries.
 */
export const TURN_SAVE_FAILED_MESSAGE =
  'Your turn was not saved. The Citizen service did not accept it, so the screen still shows the last saved month.';
export const TURN_RETRY_FAILED_MESSAGE =
  'Retry did not save your turn either. The screen still shows the last saved month.';
export const TURN_BLOCKED_MESSAGE =
  'Your last turn is not saved yet. Retry it before playing another turn.';
export const TURN_RETRY_HINT = 'Retry loads the saved campaign, then sends the turn again.';

export default function TurnSaveAlert({ message, announceKey = 0, retrying = false, onRetry }) {
  if (!message) return null;
  return (
    <div className="data-source data-source--alert turn-save-alert" data-testid="turn-save-alert">
      <p key={announceKey} role="alert" className="turn-save-alert__message">
        {message} {TURN_RETRY_HINT}
      </p>
      <button
        type="button"
        className="turn-save-alert__retry"
        onClick={onRetry}
        disabled={retrying}
        aria-busy={retrying ? 'true' : 'false'}
      >
        {retrying ? 'Retrying…' : 'Retry saving turn'}
      </button>
    </div>
  );
}
