import { useRef } from 'react';
import FocusButton from './FocusButton';
import FocusGroup from './FocusGroup';
import { useNavLeaf } from './focusStore';
import { useNavKey } from './focusGroups';
import { setHandheldScale, useHandheldScale } from './tv';
export default function DeviceScaleSettings() {
  const scale = useHandheldScale();
  const ref = useRef<HTMLInputElement>(null);
  const key = useNavKey('handheld-interface-scale');
  const leaf = useNavLeaf(key, ref, { on: true, onArrow: (arrow) => {
    if (arrow !== 'left' && arrow !== 'right') return false;
    setHandheldScale(scale + (arrow === 'left' ? -5 : 5)); return true;
  }});
  return <section className="settings-section device-scale-settings">
    <h3>Handheld interface scale</h3>
    <p className="settings-intro">Larger text and controls for a small screen. Applies in Handheld mode and is remembered on this device. Use Left/Right to adjust.</p>
    <FocusGroup kind="row" className="settings-row">
      <label>Interface scale <output>{scale}%</output><input ref={ref} type="range" aria-label="Handheld interface scale" min="85" max="115" step="5" value={scale} className={leaf.focused ? 'focused' : ''} onChange={(event) => setHandheldScale(Number(event.target.value))} {...leaf.props} /></label>
      <FocusButton onSelect={() => setHandheldScale(100)}>Reset scale</FocusButton>
    </FocusGroup>
  </section>;
}
