import { useEffect, useRef, useState, type ReactNode } from 'react';
import '../styles/dock.css';

// ── Dock navigation ────────────────────────────────────────────────────────
// A fixed glass panel on the left. Hovering an item magnifies only that item
// (neighbours shift slightly), and its name appears beside it. On phones the
// dock becomes a bottom bar without magnification.

export type DockTheme = 'light' | 'dark' | 'system';

export interface DockItem {
  key: string;
  label: string;
  icon: ReactNode;
}

interface DockProps {
  /** Groups of items, drawn with a separator between groups. */
  groups: DockItem[][];
  currentKey: string;
  onNavigate: (key: string) => void;
  /** Number shown on the Review queue item; hidden when 0. */
  reviewCount: number;
  accountEmail: string;
  isDark: boolean;
  onSetTheme: (theme: DockTheme) => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
  /** URL of a page, for "Open in new window" in the Overview context menu. */
  hrefFor: (key: string) => string;
}

const MAGNIFIED = 100 / 56; // item grows from 56px to 100px
const NEIGHBOUR_SHIFT = 0.12; // neighbours move by 12% of the growth

function useMagnification(): boolean {
  const query = '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
  const [enabled, setEnabled] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setEnabled(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return enabled;
}

function initialsFrom(email: string): string {
  const words = email.split('@')[0].split(/[._\-\s]+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

export default function Dock({
  groups,
  currentKey,
  onNavigate,
  reviewCount,
  accountEmail,
  isDark,
  onSetTheme,
  onOpenProfile,
  onSignOut,
  hrefFor,
}: DockProps) {
  const magnify = useMagnification();
  const [hovered, setHovered] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  // One running index across groups, so neighbours are found across separators.
  let index = -1;

  const transformFor = (i: number): string | undefined => {
    if (!magnify || hovered === null) return undefined;
    if (i === hovered) return `scale(${MAGNIFIED})`;
    if (Math.abs(i - hovered) === 1) {
      const shift = `calc(var(--dock-item) * ${((MAGNIFIED - 1) * NEIGHBOUR_SHIFT).toFixed(3)})`;
      return `translateY(${i < hovered ? '-' : ''}${shift})`;
    }
    return undefined;
  };

  return (
    <>
      <nav className="dock" aria-label="Workspace" onMouseLeave={() => setHovered(null)}>
        <button type="button" className="dock-logo" onClick={() => onNavigate('dashboard')} aria-label="ClaimGuard AI home">
          <LogoMark />
        </button>

        {groups.map((group, groupIndex) => (
          <div key={groupIndex} className="dock-group">
            {groupIndex > 0 && <div className="dock-separator" aria-hidden="true" />}
            {group.map((item) => {
              index += 1;
              const i = index;
              const isActive = currentKey === item.key;
              const badge = item.key === 'review-queue' && reviewCount > 0 ? reviewCount : null;
              const isHovered = hovered === i;
              return (
                <div key={item.key} className="dock-slot">
                  <div className="dock-scale" style={{ transform: transformFor(i) }}>
                    <button
                      type="button"
                      className={`dock-item${isActive ? ' is-active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={badge ? `${item.label}, ${badge} claims need review` : item.label}
                      onMouseEnter={() => setHovered(i)}
                      onFocus={() => setHovered(i)}
                      onBlur={() => setHovered(null)}
                      onClick={() => onNavigate(item.key)}
                      onContextMenu={item.key === 'dashboard' ? (event) => {
                        event.preventDefault();
                        setContextMenu({ x: event.clientX, y: event.clientY });
                      } : undefined}
                    >
                      {item.icon}
                      {badge !== null && <span className="dock-badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
                    </button>
                  </div>
                  <span
                    className={`dock-label${isHovered ? ' is-visible' : ''}`}
                    style={{ '--label-scale': magnify && isHovered ? MAGNIFIED : 1 } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        ))}

        <div className="dock-account">
          <button
            type="button"
            className="dock-avatar"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            aria-label="Account menu"
            onClick={() => setAccountOpen((open) => !open)}
          >
            {initialsFrom(accountEmail)}
            <span className="dock-online" aria-hidden="true" />
          </button>
          <div className="dock-theme" role="group" aria-label="Colour theme">
            <button type="button" aria-pressed={!isDark} aria-label="Light theme" onClick={() => onSetTheme('light')}>
              <SunIcon />
            </button>
            <button type="button" aria-pressed={isDark} aria-label="Dark theme" onClick={() => onSetTheme('dark')}>
              <MoonIcon />
            </button>
          </div>
          <button type="button" className="dock-item dock-logout" aria-label="Log out" onClick={onSignOut}>
            <LogoutIcon />
          </button>
        </div>
      </nav>

      {accountOpen && (
        <Menu label="Account" onClose={() => setAccountOpen(false)} className="dock-menu dock-account-menu">
          <div className="dock-menu-heading">Your account</div>
          <MenuItem onSelect={() => { setAccountOpen(false); onOpenProfile(); }}>Profile and preferences</MenuItem>
          <MenuItem onSelect={() => { setAccountOpen(false); onSignOut(); }}>Sign out</MenuItem>
        </Menu>
      )}

      {contextMenu && (
        <OverviewMenu
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenInNewWindow={() => window.open(hrefFor('dashboard'), '_blank', 'noopener')}
          onOpenProfile={onOpenProfile}
          onSetTheme={onSetTheme}
          onSignOut={onSignOut}
        />
      )}
    </>
  );
}

// ── Menus ──────────────────────────────────────────────────────────────────

function Menu({
  label,
  onClose,
  className,
  style,
  children,
}: {
  label: string;
  onClose: () => void;
  className: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Arrow keys move between the items of this menu.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation(); // a submenu handles its own items
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={ref} role="menu" aria-label={label} className={className} style={style} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

function MenuItem({
  onSelect,
  children,
  checked,
  ...rest
}: {
  onSelect: () => void;
  children: ReactNode;
  checked?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'>) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className="dock-menu-item"
      onClick={onSelect}
      {...rest}
    >
      {children}
    </button>
  );
}

function OverviewMenu({
  position,
  onClose,
  onOpenInNewWindow,
  onOpenProfile,
  onSetTheme,
  onSignOut,
}: {
  position: { x: number; y: number };
  onClose: () => void;
  onOpenInNewWindow: () => void;
  onOpenProfile: () => void;
  onSetTheme: (theme: DockTheme) => void;
  onSignOut: () => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Menu label="Overview" onClose={onClose} className="dock-menu" style={{ left: position.x, top: position.y }}>
      <MenuItem onSelect={run(onOpenInNewWindow)}>Open in new window</MenuItem>
      <MenuItem
        aria-haspopup="menu"
        aria-expanded={optionsOpen}
        onSelect={() => setOptionsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') setOptionsOpen(true);
        }}
        onMouseEnter={() => setOptionsOpen(true)}
      >
        Options <span className="dock-menu-caret" aria-hidden="true" />
      </MenuItem>
      {optionsOpen && (
        <Menu label="Options" onClose={() => setOptionsOpen(false)} className="dock-menu dock-submenu">
          <MenuItem onSelect={run(onOpenProfile)}>Profile and preferences</MenuItem>
          <MenuItem onSelect={run(() => onSetTheme('light'))}>Light theme</MenuItem>
          <MenuItem onSelect={run(() => onSetTheme('dark'))}>Dark theme</MenuItem>
          <MenuItem onSelect={run(() => onSetTheme('system'))}>Match system theme</MenuItem>
        </Menu>
      )}
      <div className="dock-menu-separator" role="separator" />
      <MenuItem onSelect={run(onSignOut)}>Sign out</MenuItem>
    </Menu>
  );
}

// ── Icons: 24px, rounded strokes (Hugeicons stroke-rounded style) ──────────

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const DockIcons = {
  home: (
    <Icon>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9v10.5c0 .8.7 1.5 1.5 1.5H10v-6h4v6h3.5c.8 0 1.5-.7 1.5-1.5V9" />
    </Icon>
  ),
  file: (
    <Icon>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Icon>
  ),
  task: (
    <Icon>
      <path d="M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="M9 3.5h6v3H9zM9 14l2 2 4-4" />
    </Icon>
  ),
  play: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l5.5-3.5z" />
    </Icon>
  ),
  shield: (
    <Icon>
      <path d="M12 3 5 6v5c0 4.6 3 8.4 7 10 4-1.6 7-5.4 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  ),
  cloud: (
    <Icon>
      <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 8.6 4.7 4.7 0 0 1 17 18" />
      <path d="M12 21v-8M9 15.5l3-3 3 3" />
    </Icon>
  ),
  book: (
    <Icon>
      <path d="M12 6.5C10 5 7 4.5 4 5v14c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z" />
      <path d="M12 6.5v14" />
    </Icon>
  ),
  gear: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Icon>
  ),
  chart: (
    <Icon>
      <path d="M3.5 3.5v15a2 2 0 0 0 2 2h15" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </Icon>
  ),
};

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.6 3 8.4 7 10 4-1.6 7-5.4 7-10V6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="11.5" r="1.8" fill="currentColor" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2H9M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
