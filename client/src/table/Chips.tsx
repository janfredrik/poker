import { formatChips } from '../../../shared/presets';

/* Clay chip denominations from the home-game tin: one colour per value.
   Small games use the low set; tables whose small blind is a multiple of 25 use the high set. */
const LOW = [{ v: 500, c: 'chip--blue' }, { v: 100, c: 'chip--black' }, { v: 25, c: 'chip--green' }, { v: 5, c: 'chip--red' }, { v: 1, c: 'chip--bone' }];
const HIGH = [{ v: 5000, c: 'chip--blue' }, { v: 1000, c: 'chip--black' }, { v: 500, c: 'chip--green' }, { v: 100, c: 'chip--red' }, { v: 25, c: 'chip--bone' }];
let DENOMS = HIGH;
/** Pick the chip set from the table's starting small blind. */
export function setChipScale(smallBlind: number) { DENOMS = smallBlind % 25 === 0 ? HIGH : LOW; }

/** Break an amount into up to 4 short columns of chips. */
function columns(amount: number, maxCols = 4, maxPerCol = 7) {
  const cols: { c: string; n: number }[] = [];
  let rest = Math.round(amount);
  for (const d of DENOMS) {
    if (rest < d.v) continue;
    const n = Math.floor(rest / d.v);
    rest -= n * d.v;
    cols.push({ c: d.c, n: Math.min(n, maxPerCol) });
    if (cols.length >= maxCols) break;
  }
  if (rest > 0 && cols.length < maxCols) cols.push({ c: 'chip--bone', n: 1 });
  return cols;
}

export function ChipStack({ amount, label = true, size = 'md' }: { amount: number; label?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  if (amount <= 0) return null;
  const cols = columns(amount, size === 'lg' ? 5 : size === 'sm' ? 2 : 3, size === 'lg' ? 9 : size === 'sm' ? 4 : 6);
  return (
    <span className={`chips chips--${size}`}>
      <span className="chips__pile" aria-hidden="true">
        {cols.map((col, i) => (
          <span className="chips__col" key={i}>
            {Array.from({ length: col.n }, (_, j) => (
              <span key={j} className={`chip ${col.c}`} style={{ ['--i' as string]: j }} />
            ))}
          </span>
        ))}
      </span>
      {label && <span className="chips__amount">{formatChips(amount)}</span>}
    </span>
  );
}
