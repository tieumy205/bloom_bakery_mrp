import { useEffect, useState } from 'react';
import type { InputHTMLAttributes } from 'react';

// Preserve intermediate input such as "0." instead of coercing it back to 0.
export function DecimalInput({
  value,
  onValueChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number;
  onValueChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((old) => ((Number(old.replace(',', '.')) || 0) === value ? old : String(value)));
  }, [value]);
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      pattern="[0-9]+([.,][0-9]{1,6})?"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        if (!/^\d*([.,]\d{0,6})?$/.test(next)) return;
        setText(next);
        onValueChange(Number(next.replace(',', '.')) || 0);
      }}
    />
  );
}
