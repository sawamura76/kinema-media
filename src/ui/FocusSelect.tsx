import { useRef } from 'react';
import { useNavKey } from './focusGroups';
import { useNavLeaf } from './focusStore';

interface Props {
  label: string;
  focusKey?: string;
  value: string;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}
export default function FocusSelect({ label, value, choices, onChange, disabled = false, focusKey }: Props) {
  const ref = useRef<HTMLSelectElement>(null);
  const key = useNavKey(focusKey);
  const leaf = useNavLeaf(key, ref, {
    on: true, disabled,
    onSelect: () => {
      ref.current?.focus();
      const select = ref.current as (HTMLSelectElement & { showPicker?: () => void }) | null;
      try { select?.showPicker?.(); } catch { /* Older WebViews keep native keyboard selection. */ }
    },
    onArrow: (arrow) => {
      if (arrow !== 'left' && arrow !== 'right') return false;
      const index = choices.findIndex((choice) => choice.value === value);
      const next = choices[Math.max(0, Math.min(choices.length - 1, index + (arrow === 'left' ? -1 : 1)))];
      if (next) onChange(next.value);
      return true;
    },
  });
  return <select ref={ref} aria-label={label} value={value} disabled={disabled}
    className={leaf.focused ? 'focused' : ''} onChange={(event) => onChange(event.target.value)} {...leaf.props}>
    {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
  </select>;
}
