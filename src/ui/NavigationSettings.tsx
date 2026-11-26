import ChoiceRow from './ChoiceRow';
import { setMouseNavigation, useMouseNavigationEnabled } from './navigationPreferences';
import { setFloatingEnabled, useFloatingEnabled } from '../player/floating';

export default function NavigationSettings() {
  const mouse = useMouseNavigationEnabled();
  const musicMini = useFloatingEnabled('music');
  const videoMini = useFloatingEnabled('video');
  return <section className="settings-section">
    <h2>Navigation & controls</h2>
    <ChoiceRow label="Music mini-player" value={musicMini ? 'on' : 'off'} onChange={(v) => setFloatingEnabled('music', v === 'on')} choices={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} note="Minimize while listening to open an always-on-top, movable, resizable player with artwork and track controls. Paused music keeps the player available." />
    <ChoiceRow label="Video mini-player" value={videoMini ? 'on' : 'off'} onChange={(v) => setFloatingEnabled('video', v === 'on')} choices={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} note="Minimize a movie, TV episode or local video to keep its picture playing in a movable, resizable window above other apps. Restore returns to the previous window layout. Minimizing the mini-player itself hides it normally." />
    <ChoiceRow label="Mouse Back / Forward" value={mouse ? 'on' : 'off'} onChange={(v) => setMouseNavigation(v === 'on')} choices={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} note="Use extra mouse buttons to go back and forward through app pages, artists and albums. Browser Back/Forward key messages from mouse drivers follow this switch too. Off makes these buttons do nothing inside Kinema; ordinary keyboard and controller navigation stays available." />
    <h3>Remote controls</h3>
    <p className="settings-intro">Keyboard-style USB/Bluetooth remotes can use arrows, Enter/OK and Escape/Backspace. Left/right bumpers switch Home, Movies, TV, Music and Games. Standard Xbox/Ally controllers use the existing D-pad, A and B mappings while the app has focus.</p>
    <p className="settings-hint">HDMI-CEC TV-remote passthrough and configurable remote mappings are future features. Their settings will live here. No CEC connection or device is configured by this build.</p>
  </section>;
}
