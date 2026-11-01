import { resolveFeatureView } from '../views/featureViews';
import WindowFrame from './WindowFrame';
import { COMPANY_METRICS_ID, COMPANY_OPS_ID } from './windowModel';

export default function WindowManager({ workspace, onAction, models, viewProps }) {
  const openWindows = [...workspace.windows]
    .filter((item) => item.open)
    .sort((a, b) => a.z - b.z);

  return (
    <div className="window-layer">
      {openWindows.map((item) => {
        const View = resolveFeatureView(item.id);
        if (!View) return null;
        if (item.id === COMPANY_OPS_ID || item.id === COMPANY_METRICS_ID) {
          const props = viewProps?.[item.id];
          if (props == null) return null;
          return (
            <WindowFrame key={item.id} windowRecord={item} onAction={onAction}>
              <View {...props} />
            </WindowFrame>
          );
        }
        const model = models?.[item.id];
        if (model == null) return null;
        return (
          <WindowFrame key={item.id} windowRecord={item} onAction={onAction}>
            <View model={model} />
          </WindowFrame>
        );
      })}
    </div>
  );
}
