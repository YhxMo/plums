import { Fragment } from "react";
import {
  Select as SelectRoot,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export type SelectOption = {
  value: string;
  label: string;
  /** Second line in the list, such as which service a model belongs to. */
  description?: string;
  /** Heading the option is listed under; consecutive options share one. */
  group?: string;
};

// Item values must be non-empty; an empty option value is a valid choice here.
const key = (value: string) => `v:${value}`;

/**
 * Single-choice picker with the app's menu styling. Arrows, Home/End,
 * Enter/Space and typeahead work as in a native select; Escape and system
 * Back close only the list, not the dialog around it.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder = "请选择",
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = options.some((option) => option.value === value);
  return (
    <SelectRoot
      value={selected ? key(value) : ""}
      disabled={disabled}
      onValueChange={(next) => {
        const choice = next.slice(2);
        if (choice !== value) onChange(choice);
      }}
    >
      <SelectTrigger aria-label={label} className="w-full min-w-0 bg-card">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" aria-label={label}>
        {groups(options).map(({ group, items }) => {
          const rows = items.map((option) => (
            <SelectItem
              key={option.value}
              value={key(option.value)}
              description={option.description}
            >
              {option.label}
            </SelectItem>
          ));
          return group === undefined ? (
            <Fragment key={`rows-${items[0].value}`}>{rows}</Fragment>
          ) : (
            <SelectGroup key={`group-${items[0].value}`}>
              <SelectLabel>{group}</SelectLabel>
              {rows}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </SelectRoot>
  );
}

function groups(options: readonly SelectOption[]) {
  const result: { group?: string; items: SelectOption[] }[] = [];
  for (const option of options) {
    const last = result.at(-1);
    if (last && last.group === option.group) last.items.push(option);
    else result.push({ group: option.group, items: [option] });
  }
  return result;
}
