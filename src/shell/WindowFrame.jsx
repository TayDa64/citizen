import { useId } from 'react';
import {
  CAMPAIGN_POLITICS_ID,
  CAMPAIGN_RUNWAY_ID,
  COMPANY_METRICS_ID,
  COMPANY_OPS_ID,
  TITLE_BAR_HEIGHT,
} from './windowModel';

function titleFor(id) {
  switch (id) {
    case CAMPAIGN_RUNWAY_ID:
      return 'Campaign runway';
    case COMPANY_OPS_ID:
      return 'Ops desk';
    case COMPANY_METRICS_ID:
      return 'Company metrics';
    case CAMPAIGN_POLITICS_ID:
      return 'Politics';
    default:
      return 'Window';
  }
}

function pointerDownOnControl(event) {
  const native = event.nativeEvent ?? event;
  const nodes = typeof native.composedPath === 'function' ? native.composedPath() : [];
  nodes.push(native.target, event.target);
  return nodes.some((node) => {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(element?.closest?.('button, a, input, select, textarea, label'));
  });
}

function readBounds(node) {
  const shell = node?.closest?.('.spatial-shell');
  const rect = shell?.getBoundingClientRect?.();
  const width = rect?.width || shell?.clientWidth || 0;
  const height = rect?.height || shell?.clientHeight || 0;
  return {
    width: width > 0 ? width : 1280,
    height: height > 0 ? height : 900,
  };
}

export default function WindowFrame({ windowRecord, onAction, children }) {
  const titleId = useId();
  const title = titleFor(windowRecord.id);
  const { placement, minimized, pinned } = windowRecord;

  const focus = () => {
    onAction({ type: 'focus', id: windowRecord.id });
  };

  const keepControlClick = (event) => {
    event.stopPropagation();
  };

  const onTitlePointerDown = (event) => {
    if (event.button !== 0) return;
    // A title-bar control must still receive its click. preventDefault on
    // pointerdown suppresses the click, which drops Close / Pin / Minimize.
    if (pointerDownOnControl(event)) return;
    event.preventDefault();
    focus();
    const originX = placement.x;
    const originY = placement.y;
    const startX = event.clientX;
    const startY = event.clientY;
    const bounds = readBounds(event.currentTarget);
    const handle = event.currentTarget;
    const onMove = (ev) => {
      onAction({
        type: 'move',
        id: windowRecord.id,
        x: originX + (ev.clientX - startX),
        y: originY + (ev.clientY - startY),
        bounds,
      });
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.setPointerCapture?.(event.pointerId);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  const resizeBy = (width, height, node) => {
    onAction({
      type: 'resize',
      id: windowRecord.id,
      width,
      height,
      bounds: readBounds(node),
    });
  };

  const onResizePointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    focus();
    const originW = placement.width;
    const originH = placement.height;
    const startX = event.clientX;
    const startY = event.clientY;
    const handle = event.currentTarget;
    const onMove = (ev) => {
      resizeBy(originW + (ev.clientX - startX), originH + (ev.clientY - startY), handle);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.setPointerCapture?.(event.pointerId);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  const onResizeKey = (event) => {
    const step = event.shiftKey ? 32 : 16;
    let width = placement.width;
    let height = placement.height;
    switch (event.key) {
      case 'ArrowRight':
        width += step;
        break;
      case 'ArrowLeft':
        width -= step;
        break;
      case 'ArrowDown':
        height += step;
        break;
      case 'ArrowUp':
        height -= step;
        break;
      default:
        return;
    }
    event.preventDefault();
    resizeBy(width, height, event.currentTarget);
  };

  return (
    <section
      className={`window-frame${minimized ? ' window-frame--minimized' : ''}`}
      data-testid={windowRecord.id}
      role="region"
      aria-labelledby={titleId}
      style={{
        left: placement.x,
        top: placement.y,
        width: placement.width,
        height: minimized ? TITLE_BAR_HEIGHT : placement.height,
        zIndex: windowRecord.z,
      }}
      onPointerDown={focus}
    >
      <div className="window-frame__glow" aria-hidden="true" />
      <div className="window-frame__scrim">
        <div className="window-titlebar" onPointerDown={onTitlePointerDown}>
          <h2 id={titleId} className="window-titlebar__title">{title}</h2>
          <div className="window-titlebar__controls">
            <button
              type="button"
              aria-pressed={pinned}
              onPointerDown={keepControlClick}
              onClick={() => onAction({
                type: 'pin',
                id: windowRecord.id,
                pinned: !pinned,
              })}
            >
              Pin
            </button>
            <button
              type="button"
              onPointerDown={keepControlClick}
              onClick={() => onAction({
                type: minimized ? 'restore' : 'minimize',
                id: windowRecord.id,
              })}
            >
              {minimized ? 'Restore' : 'Minimize'}
            </button>
            <button
              type="button"
              onPointerDown={keepControlClick}
              onClick={() => onAction({ type: 'close', id: windowRecord.id })}
            >
              Close
            </button>
          </div>
        </div>
        {minimized ? null : (
          <div className="window-frame__body">
            {children}
            <button
              type="button"
              className="window-resize"
              aria-label={`Resize ${title}`}
              onPointerDown={onResizePointerDown}
              onKeyDown={onResizeKey}
            >
              Resize
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
