import type { ReactNode } from 'react';

export function SettingGroup(props: { title?: string; description?: string; children: ReactNode }) {
  const { title, description, children } = props;
  return (
    <section className="setting-group" aria-label={title}>
      {title ? <h4 className="setting-group-title">{title}</h4> : null}
      {description ? <p className="setting-group-desc">{description}</p> : null}
      {children}
    </section>
  );
}

export function SettingRow(props: {
  htmlFor?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { htmlFor, title, description, children } = props;
  return (
    <div className="setting-row">
      <div className="setting-row-text">
        {htmlFor ? (
          <label className="setting-row-title" htmlFor={htmlFor}>
            {title}
          </label>
        ) : (
          <span className="setting-row-title">{title}</span>
        )}
        {description ? <p className="setting-row-desc">{description}</p> : null}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

export function Switch(props: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { id, checked, onChange } = props;
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className="switch"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

interface SegmentedOption<Value extends string | number> {
  value: Value;
  label: string;
}

export function Segmented<Value extends string | number>(props: {
  name: string;
  label: string;
  value: Value;
  options: readonly SegmentedOption<Value>[];
  onChange: (value: Value) => void;
}) {
  const { name, label, value, options, onChange } = props;
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className="segmented-option">
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span className="segmented-label">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
