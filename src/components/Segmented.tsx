// A row of mutually exclusive choices that are all worth seeing at once
// (theme, motion, depth). A radio group underneath, so arrow keys and
// screen readers work the way they do for any radio group.

import type { ReactNode } from "react";

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export default function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  legend,
  large = false,
}: {
  name: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  legend: string;
  large?: boolean;
}) {
  return (
    <fieldset className={`segmented${large ? " segmented-large" : ""}`}>
      <legend className="visually-hidden">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={`segment${o.value === value ? " is-on" : ""}${o.disabled ? " is-disabled" : ""}`}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          <span className="segment-label">{o.label}</span>
          {o.hint && <span className="segment-hint">{o.hint}</span>}
        </label>
      ))}
    </fieldset>
  );
}
