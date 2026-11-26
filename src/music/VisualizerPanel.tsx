import { useOutsideDismiss } from '../ui/useOutsideDismiss';
import { BackgroundSourceSelect } from './BackgroundSources';
import { useEffect, useRef, useState } from 'react';
import FocusButton from '../ui/FocusButton';
import { FocusProvider } from '../ui/FocusGroup';
import FocusGroup from '../ui/FocusGroup';
import { useFocusGroup } from '../ui/focusGroups';
import ChoiceRow from '../ui/ChoiceRow';
import { presets } from './butterchurnPresets';
import { ART_MODES, SPECTRUM_MODES, setVisualizationSettings, useVisualizationSettings } from './visualizationSettings';
import { useMusicLanguage } from './language';

export default function VisualizerPanel({ preset, onPreset, onNext, onClose }: { preset: number; onPreset: (index: number) => void; onNext: () => void; onClose: () => void }) {
  const { language, t } = useMusicLanguage(), ja = language === 'ja';
  const settings = useVisualizationSettings();
  const { ref, focusKey } = useFocusGroup('menu', { current: 'viz-category', wrap: 'vertical' });
  const [dropdown, setDropdown] = useState(false);
  useOutsideDismiss(true, '.music-viz-panel, [aria-controls=music-visualizer-panel]', onClose);
  useOutsideDismiss(dropdown, '.music-viz-category, .music-viz-dropdown', () => setDropdown(false));
  const scroll = useRef<HTMLDivElement>(null);
  const category = settings.background === 'butterchurn' ? 'butterchurn' : ART_MODES.some((v) => v === settings.background) ? 'art' : 'spectrum';
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [category]);
  const title = ja ? 'ビジュアライザー' : 'Visualizer';
  const categories = [{ key: 'art', label: ja ? 'アート' : 'Art' }, { key: 'butterchurn', label: 'Butterchurn' }, { key: 'spectrum', label: ja ? 'スペクトラムアナライザー' : 'Spectrum analyzer' }];
  useEffect(() => {
    const back = (e: KeyboardEvent) => {
      if (['Escape', 'Backspace', 'BrowserBack'].includes(e.key)) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (dropdown) setDropdown(false); else onClose();
      }
    };
    window.addEventListener('keydown', back, true); return () => window.removeEventListener('keydown', back, true);
  }, [dropdown, onClose]);
  const changeCategory = (key: string) => {
    setVisualizationSettings({ background: key === 'art' ? settings.artModes[0] as 'plain' : key === 'butterchurn' ? 'butterchurn' : settings.spectrumModes[0] as 'radial' });
    setDropdown(false);
  };
  const modes = category === 'art' ? ART_MODES : SPECTRUM_MODES;
  const included = category === 'art' ? settings.artModes : settings.spectrumModes;
  const rotate = category === 'art' ? settings.artRotate : category === 'butterchurn' ? settings.rotate : settings.spectrumRotate;
  const seconds = category === 'art' ? settings.slideshowSeconds : category === 'butterchurn' ? settings.presetSeconds : settings.spectrumSeconds;
  const toggle = (name: string) => {
    const list = category === 'butterchurn' ? settings.presetNames : included;
    const next = list.includes(name) ? list.filter((v) => v !== name) : [...list, name];
    if (!next.length) return;
    if (category === 'butterchurn') {
      setVisualizationSettings({ presetNames: next });
      if (!next.includes(presets[preset].name)) onPreset(presets.findIndex((p) => p.name === next[0]));
    } else {
      setVisualizationSettings({ [category === 'art' ? 'artModes' : 'spectrumModes']: next, ...(!next.includes(settings.background) ? { background: next[0] as typeof settings.background } : {}) });
    }
  };
  return <FocusProvider value={focusKey}><aside ref={ref} className="music-viz-panel" role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2><FocusButton label={ja ? 'パネルを閉じる' : 'Close visualizer panel'} onSelect={onClose}>→</FocusButton></header>
    <FocusButton focusKey="viz-category" className="music-viz-category" expanded={dropdown} controls="viz-categories" label={`${ja ? 'カテゴリー' : 'Category'}: ${categories.find((c) => c.key === category)?.label}`} onSelect={() => setDropdown(!dropdown)}>{categories.find((c) => c.key === category)?.label}<span>▾</span></FocusButton>
    {dropdown && <div id="viz-categories" className="music-viz-dropdown">{categories.map((c) => <FocusButton key={c.key} pressed={c.key === category} onSelect={() => changeCategory(c.key)}>{c.label}</FocusButton>)}</div>}
    <div ref={scroll} className="music-viz-scroll">
    <p className="music-viz-hint">{ja ? '名前で表示を選択。チェックした項目を順番に表示します。各カテゴリーに最低1つ必要です。' : 'Select a name to display it. Checked items join rotation. Keep at least one in each category.'}</p>
    <div className="music-viz-items" aria-label={ja ? 'エフェクト' : 'Visual effects'}>
      {(category === 'butterchurn' ? presets.map((p) => p.name) : [...modes]).map((name) => {
        const selected = category === 'butterchurn' ? presets[preset].name === name : settings.background === name;
        const list = category === 'butterchurn' ? settings.presetNames : included;
        const label = category === 'butterchurn' ? name : t(name as typeof modes[number]);
        return <FocusGroup kind="row" className="music-viz-item" key={name}>
          <FocusButton pressed={list.includes(name)} disabled={list.length === 1 && list.includes(name)} label={`${ja ? '含める' : 'Include'} ${label}`} onSelect={() => toggle(name)}>{list.includes(name) ? '✓' : '＋'}</FocusButton>
          <FocusButton className={selected ? 'selected' : ''} pressed={selected} label={`${ja ? '表示' : 'Show'} ${label}`} onSelect={() => {
            if (!list.includes(name)) toggle(name);
            if (category === 'butterchurn') onPreset(presets.findIndex((p) => p.name === name));
            else setVisualizationSettings({ background: name as typeof settings.background });
          }}>{label}</FocusButton>
        </FocusGroup>;
      })}
    </div>
    <ChoiceRow label={ja ? '表示モード' : 'Playback mode'} value={rotate ? 'rotate' : 'static'} choices={[{ value: 'static', label: ja ? '固定' : 'Static' }, { value: 'rotate', label: ja ? '順番に表示' : 'Rotate' }]} onChange={(v) => setVisualizationSettings({ [category === 'art' ? 'artRotate' : category === 'butterchurn' ? 'rotate' : 'spectrumRotate']: v === 'rotate' })} />
    <ChoiceRow label={ja ? '切り替え間隔' : 'Rotation time'} value={String(seconds)} choices={[...(category === 'butterchurn' ? [] : [5]), 10, 15, 30, 45, 60, 120].map((n) => ({ value: String(n), label: ja ? `${n}秒` : `${n}s` }))} onChange={(v) => setVisualizationSettings({ [category === 'art' ? 'slideshowSeconds' : category === 'butterchurn' ? 'presetSeconds' : 'spectrumSeconds']: Number(v) })} />
    {category !== 'art' && <ChoiceRow label={ja ? '感度' : 'Sensitivity'} value={String(category === 'butterchurn' ? settings.butterchurnSensitivity : settings.spectrumSensitivity)} choices={[.5, 1, 1.5, 2, 3].map((n) => ({ value: String(n), label: `${n}×` }))} onChange={(v) => setVisualizationSettings({ [category === 'butterchurn' ? 'butterchurnSensitivity' : 'spectrumSensitivity']: Number(v) })} note={ja ? '表示だけを調整します。音量は変わりません。' : 'Changes visual response only; listening volume stays the same.'} />}
    {category === 'art' && <>
      <BackgroundSourceSelect />
      <ChoiceRow label={ja ? '画像ソース' : 'Artwork source'} value={settings.artistArt ? 'artist' : 'album'} choices={[{ value: 'artist', label: t('artistBackground') }, { value: 'album', label: t('albumBackground') }]} onChange={(v) => setVisualizationSettings({ artistArt: v === 'artist' })} />
      <ChoiceRow label={ja ? '画像サイズ' : 'Image sizing'} value={settings.imageFit} choices={[{ value: 'fit', label: ja ? '全体表示' : 'Fit' }, { value: 'fill', label: ja ? '画面を埋める' : 'Fill' }]} onChange={(imageFit) => setVisualizationSettings({ imageFit })} />
    </>}
    {category === 'butterchurn' && <FocusButton onSelect={onNext}>{t('nextPreset')}: {presets[preset].name}</FocusButton>}
    <ChoiceRow label={ja ? '曲の情報' : 'Cover and song details'} value={settings.showDetails ? 'show' : 'hide'} choices={[{ value: 'show', label: ja ? '表示' : 'Show' }, { value: 'hide', label: ja ? '非表示' : 'Hide' }]} onChange={(v) => setVisualizationSettings({ showDetails: v === 'show' })} />
    </div>
  </aside></FocusProvider>;
}
