import BackgroundSources from '../music/BackgroundSources';
import ChoiceRow from './ChoiceRow';
import { DEFAULT_VISUALIZATIONS, setVisualizationSettings, useVisualizationSettings, type VisualizationSettings as Preferences } from '../music/visualizationSettings';
import FocusButton from './FocusButton';

export default function VisualizationSettings() {
  const value = useVisualizationSettings();
  const seconds = (label: string, key: 'slideshowSeconds' | 'presetSeconds' | 'imageFadeSeconds' | 'presetBlendSeconds' | 'controlsSeconds', choices: number[], note?: string) => <ChoiceRow label={label} value={String(value[key])} onChange={(n) => setVisualizationSettings({ [key]: Number(n) })} choices={choices.map((n) => ({ value: String(n), label: key === 'controlsSeconds' && n === 0 ? 'Always visible' : `${n} seconds` }))} note={note} />;
  return <section className="settings-section">
    <h2>Visualizations</h2>
    <p className="settings-intro">Music backgrounds, Butterchurn and spectrum analyzers. Changes save automatically. Pausing music or hiding the window pauses the slideshow and rendering; reduced motion remains respected.</p>
    <ChoiceRow label="Default music background" value={value.background} onChange={(background) => setVisualizationSettings({ background })} choices={[{ value: 'plain', label: 'Plain image' }, { value: 'blurred', label: 'Blurred image' }, { value: 'butterchurn', label: 'Butterchurn' }, { value: 'radial', label: 'Radial spectrum' }, { value: 'led', label: 'Retro LED' }, { value: 'spectrum', label: 'Color spectrum' }]} />
    <ChoiceRow label="Artwork source" value={value.artistArt ? 'artist' : 'album'} onChange={(v) => setVisualizationSettings({ artistArt: v === 'artist' })} choices={[{ value: 'artist', label: 'Artist artwork' }, { value: 'album', label: 'Album cover' }]} />
    <BackgroundSources />
    {seconds('Slideshow image duration', 'slideshowSeconds', [5, 10, 15, 30, 60, 120])}
    {seconds('Image crossfade', 'imageFadeSeconds', [0, 1, 2, 3, 5])}
    <ChoiceRow label="Image sizing" value={value.imageFit} onChange={(imageFit) => setVisualizationSettings({ imageFit })} choices={[{ value: 'fit', label: 'Fit whole image' }, { value: 'fill', label: 'Fill screen' }]} note="Fill screen may crop the image edges; Fit whole image keeps the complete picture." />
    <ChoiceRow label="Preset rotation" value={value.rotate ? 'rotate' : 'keep'} onChange={(v) => setVisualizationSettings({ rotate: v === 'rotate' })} choices={[{ value: 'keep', label: 'Keep this preset' }, { value: 'rotate', label: 'Rotate presets' }]} />
    {seconds('Visualization duration', 'presetSeconds', [10, 15, 30, 45, 60, 120], 'Time before moving to the next Butterchurn preset. Manual Next preset works in either rotation mode.')}
    {seconds('Preset blend', 'presetBlendSeconds', [0, 1, 2, 3, 5])}
    <ChoiceRow label="Visualizer performance" value={value.quality} onChange={(quality) => setVisualizationSettings({ quality })} choices={[{ value: 'battery', label: 'Battery saver' }, { value: 'balanced', label: 'Balanced' }, { value: 'high', label: 'High quality' }]} note="Battery saver: 640×360 / 24 fps. Balanced: 960×540 / 30 fps. High quality: 1280×720 / 60 fps, with greater GPU and battery use." />
    {seconds('Hide playback controls after', 'controlsSeconds', [0, 5, 10, 15, 30])}
    <ChoiceRow label="Cover and song details" value={value.showDetails ? 'show' : 'hide'} onChange={(v) => setVisualizationSettings({ showDetails: v === 'show' })} choices={[{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }]} />
    <FocusButton className="btn-secondary" onSelect={() => setVisualizationSettings(DEFAULT_VISUALIZATIONS as Preferences)}>Reset visualization settings</FocusButton>
  </section>;
}

