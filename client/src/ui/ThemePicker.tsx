import { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { ROOMS, useTheme } from '../lib/theme';

/** Room colours for this browser. Other players keep their own choice. */
export function ThemePicker({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className={`looks ${className}`} ref={ref}>
      <button
        className={`iconbtn ${open ? 'is-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Farger på rommet"
      >
        <Palette size={18} />
      </button>
      {open && (
        <div className="looks__panel" role="dialog" aria-label="Utseende">
          <fieldset className="looks__group">
            <legend className="looks__label">Rommet</legend>
            <div className="looks__options">
              {ROOMS.map((r) => (
                <label key={r.id} className={`looks__opt ${theme.room === r.id ? 'is-on' : ''}`}>
                  <input type="radio" name="looks-room" checked={theme.room === r.id} onChange={() => setTheme({ room: r.id })} />
                  <span className="looks__swatch looks__swatch--room" style={{ ['--sw' as string]: r.swatch, ['--sw-2' as string]: r.bar }} aria-hidden="true" />
                  <span className="looks__name">{r.name}</span>
                  <span className="looks__hint">{r.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="looks__note">Gjelder bare på denne enheten.</p>
        </div>
      )}
    </div>
  );
}
