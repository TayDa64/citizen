import { resolveFeatureView } from '../views/featureViews';
import WindowFrame from './WindowFrame';

export default function WindowManager({ workspace, onAction, models }) {
  const openWindows = [...workspace.windows]
    .filter((item) => item.open)
    .sort((a, b) => a.z - b.z);

  return (
    <div className="window-layer">
      {openWindows.map((item) => {
        const View = resolveFeatureView(item.id);
        const model = models?.[item.id];
        if (!View || model == null) return null;
        return (
          <WindowFrame key={item.id} windowRecord={item} onAction={onAction}>
            <View model={model} />
          </WindowFrame>
        );
      })}
    </div>
  );
}
