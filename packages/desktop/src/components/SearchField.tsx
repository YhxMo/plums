import { Icon } from "./Icon.js";
export function SearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="search-field">
      <Icon name="search" size={16} />
      <input
        type="search"
        aria-label={label}
        placeholder="搜索名称或功能"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
