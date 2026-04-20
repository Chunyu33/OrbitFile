import { ChevronDown, Check } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface FilterSelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  menuClassName?: string;
}

export default function FilterSelect<T extends string>({
  value,
  options,
  onChange,
  className = '',
  menuClassName = '',
}: FilterSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const selectedLabel = useMemo(() => {
    return options.find((item) => item.value === value)?.label ?? '';
  }, [options, value]);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const clickedOutsideTrigger = rootRef.current ? !rootRef.current.contains(target) : true;
      const clickedOutsideMenu = menuRef.current ? !menuRef.current.contains(target) : true;
      if (clickedOutsideTrigger && clickedOutsideMenu) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="h-8 w-full min-w-[88px] pl-3 pr-8 rounded-md text-[12px] text-left bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors shadow-[0_1px_0_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.28)] dark:shadow-[0_1px_0_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.03)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="block truncate">{selectedLabel}</span>
      </button>

      <ChevronDown
        className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
      />

      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          className={`absolute top-[calc(100%+6px)] left-0 z-50 overflow-hidden rounded-lg bg-[var(--bg-card)] shadow-[0_12px_30px_rgba(15,23,42,0.18)] ring-1 ring-[var(--border-color)] dark:shadow-[0_14px_32px_rgba(0,0,0,0.45)] ${menuClassName}`}
          style={{
            position: 'fixed',
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            zIndex: 2000,
          }}
          role="listbox"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`w-full h-8 px-3 text-left text-[12px] inline-flex items-center justify-between transition-colors ${selected
                  ? 'text-[var(--color-primary)] bg-[var(--color-primary-light)]/70'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
                role="option"
                aria-selected={selected}
              >
                <span>{option.label}</span>
                {selected && <Check className="w-3.5 h-3.5" />}
              </button>
            );
          })}
        </div>
      , document.body)}
    </div>
  );
}
