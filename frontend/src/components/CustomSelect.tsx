import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import './CustomSelect.css';

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type CustomSelectProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
  className?: string;
  size?: 'md' | 'sm';
  searchable?: boolean;
  emptyText?: string;
};

type MenuCoords = {
  top?: number;
  bottom?: number;
  left: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
  placement: 'bottom' | 'top';
};

export default function CustomSelect({
  id,
  value,
  onChange,
  options,
  placeholder = 'Selecciona una opción',
  disabled = false,
  required = false,
  ariaLabel,
  className = '',
  size = 'md',
  searchable,
  emptyText = 'Sin opciones disponibles',
}: CustomSelectProps) {
  const generatedId = useId();
  const listboxId = `pf-listbox-${generatedId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeBufferRef = useRef<{ text: string; timer?: number }>({ text: '' });

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [coords, setCoords] = useState<MenuCoords | null>(null);

  const showSearch = searchable ?? options.length >= 9;

  const selectedOption = useMemo(
    () => options.find(opt => opt.value === value),
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return options;
    return options.filter(opt => {
      const labelMatch = opt.label.toLowerCase().includes(clean);
      const descMatch = opt.description ? opt.description.toLowerCase().includes(clean) : false;
      return labelMatch || descMatch;
    });
  }, [options, query]);

  const computeCoords = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const placement: 'bottom' | 'top' = spaceBelow < 220 && spaceAbove > spaceBelow ? 'top' : 'bottom';
    const maxHeight = Math.max(140, Math.min(280, placement === 'top' ? spaceAbove : spaceBelow));
    const minWidth = Math.min(Math.max(rect.width, size === 'sm' ? 164 : 210), window.innerWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - minWidth - margin));
    const maxWidth = Math.max(minWidth, Math.min(440, window.innerWidth - left - margin));

    setCoords({
      ...(placement === 'top'
        ? { bottom: Math.max(margin, window.innerHeight - rect.top + 6) }
        : { top: Math.min(window.innerHeight - margin, rect.bottom + 6) }),
      left,
      minWidth,
      maxWidth,
      maxHeight,
      placement,
    });
  }, [size]);

  const moveFocusIndex = useCallback(
    (startIndex: number, step: 1 | -1) => {
      if (!filteredOptions.length) return -1;
      let idx = startIndex;
      for (let i = 0; i < filteredOptions.length; i += 1) {
        idx = (idx + step + filteredOptions.length) % filteredOptions.length;
        if (!filteredOptions[idx]?.disabled) return idx;
      }
      return -1;
    },
    [filteredOptions],
  );

  const selectOption = useCallback(
    (opt: SelectOption) => {
      if (opt.disabled) return;
      onChange(opt.value);
      setOpen(false);
      setQuery('');
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [onChange],
  );

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    computeCoords();
    const initialIdx = filteredOptions.findIndex(opt => opt.value === value && !opt.disabled);
    if (initialIdx >= 0) {
      setActiveIndex(initialIdx);
    } else {
      setActiveIndex(filteredOptions.findIndex(opt => !opt.disabled));
    }

    if (showSearch) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (activeIndex >= 0 && optionRefs.current[activeIndex]) {
      optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const onOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.closest('label')?.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => computeCoords();
    const onScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && popoverRef.current?.contains(target)) return;
      computeCoords();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === 'Tab') {
        setOpen(false);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex(prev => moveFocusIndex(prev < 0 ? -1 : prev, 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex(prev => moveFocusIndex(prev < 0 ? 0 : prev, -1));
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        setActiveIndex(filteredOptions.findIndex(opt => !opt.disabled));
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        for (let i = filteredOptions.length - 1; i >= 0; i -= 1) {
          if (!filteredOptions[i]?.disabled) {
            setActiveIndex(i);
            break;
          }
        }
        return;
      }
      const inSearchInput = document.activeElement === searchInputRef.current;
      if (event.key === 'Enter' || (event.key === ' ' && !inSearchInput)) {
        if (activeIndex >= 0 && filteredOptions[activeIndex] && !filteredOptions[activeIndex].disabled) {
          event.preventDefault();
          selectOption(filteredOptions[activeIndex]);
        }
        return;
      }
      if (!showSearch && !inSearchInput && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const nextBuffer = `${typeBufferRef.current.text}${event.key.toLowerCase()}`;
        window.clearTimeout(typeBufferRef.current.timer);
        typeBufferRef.current = {
          text: nextBuffer,
          timer: window.setTimeout(() => {
            typeBufferRef.current.text = '';
          }, 550),
        };
        const matchIdx = filteredOptions.findIndex(
          opt => !opt.disabled && opt.label.toLowerCase().startsWith(nextBuffer),
        );
        if (matchIdx >= 0) setActiveIndex(matchIdx);
      }
    };

    document.addEventListener('pointerdown', onOutsidePointer);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, activeIndex, filteredOptions, showSearch, computeCoords, moveFocusIndex, selectOption]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const displayLabel = selectedOption?.label || placeholder;
  const isPlaceholder = !selectedOption || value === '';

  return (
    <div className={`pf-select pf-select-${size} ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        className={`pf-select-trigger ${isPlaceholder ? 'is-placeholder' : ''}`}
        onClick={() => {
          if (!disabled) setOpen(prev => !prev);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="pf-select-value">{displayLabel}</span>
        <ChevronDown size={size === 'sm' ? 14 : 15} className="pf-select-chevron" aria-hidden="true" />
      </button>

      {required && (
        <input
          className="pf-select-native-proxy"
          type="text"
          tabIndex={-1}
          aria-hidden="true"
          required
          disabled={disabled}
          value={value}
          onChange={() => {}}
          onFocus={() => triggerRef.current?.focus()}
        />
      )}

      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            className={`pf-select-popover placement-${coords.placement} ${size === 'sm' ? 'pf-popover-sm' : ''}`}
            style={{
              top: coords.top !== undefined ? `${coords.top}px` : undefined,
              bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
              left: `${coords.left}px`,
              minWidth: `${coords.minWidth}px`,
              maxWidth: `${coords.maxWidth}px`,
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            {showSearch && (
              <div className="pf-select-search">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  placeholder="Filtrar opciones…"
                  aria-label="Filtrar opciones"
                  onChange={e => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                />
              </div>
            )}
            <div
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel || placeholder}
              className="pf-select-list"
              style={{ maxHeight: `${coords.maxHeight}px` }}
            >
              {filteredOptions.length ? (
                filteredOptions.map((opt, index) => {
                  const isSelected = opt.value === value;
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={`${opt.value}::${index}`}
                      ref={el => {
                        optionRefs.current[index] = el;
                      }}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={opt.disabled}
                      className={`pf-select-option ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectOption(opt)}
                    >
                      <span className="pf-select-option-text">
                        <span className="pf-select-option-label">{opt.label}</span>
                        {opt.description && <small className="pf-select-option-desc">{opt.description}</small>}
                      </span>
                      {isSelected && <Check size={14} className="pf-select-check" aria-hidden="true" />}
                    </button>
                  );
                })
              ) : (
                <div className="pf-select-empty">{emptyText}</div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
