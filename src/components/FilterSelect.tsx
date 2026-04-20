import { ChevronDown } from 'lucide-react';

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface FilterSelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export default function FilterSelect<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: FilterSelectProps<T>) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 pl-3 pr-8 rounded-md text-[12px] appearance-none bg-[var(--bg-card)]/95 text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.32)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
    </div>
  );
}
