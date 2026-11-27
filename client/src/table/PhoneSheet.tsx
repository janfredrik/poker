import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { call } from '../lib/socket';

/** Moves your seat to a phone: first choose where the camera stays, then scan the QR code. */
export function PhoneSheet({ tableId, camOn, onClose }: { tableId: string; camOn: boolean; onClose: () => void }) {
  const [keepCam, setKeepCam] = useState<boolean | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  useEffect(() => {
    if (keepCam === null) return;
    let live = true;
    let timer: number | undefined;
    setSvg(null);
    setError(null);
    call<{ code: string; expiresInMs: number }>('handoff:create', { keepCam })
      .then(async ({ code, expiresInMs }) => {
        const url = `${location.origin}/t/${tableId}#handoff=${code}`;
        const out = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1a120c', light: '#f4ecdf' } });
        if (!live) return;
        setSvg(out);
        // Make a fresh code shortly before this one expires.
        timer = window.setTimeout(() => setRound((r) => r + 1), expiresInMs - 15000);
      })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; clearTimeout(timer); };
  }, [keepCam, tableId, round]);

  return (
    <div className="sheet phone">
      <h2 className="sheet__title">Fortsett på mobilen</h2>
      {keepCam === null ? (
        <div className="phone__choice">
          <button type="button" onClick={() => setKeepCam(true)}>
            <b>Behold kameraet her</b>
            <span>Spill på mobilen og bruk kameraet på denne maskinen{camOn ? '' : ' (slå på kameraet her)'}.</span>
          </button>
          <button type="button" onClick={() => setKeepCam(false)}>
            <b>Flytt alt til mobilen</b>
            <span>Mobilen overtar kamera og mikrofon. Denne skjermen kobles fra bordet.</span>
          </button>
        </div>
      ) : (
        <>
          <p className="phone__picked">
            <span>{keepCam ? 'Kameraet blir på denne maskinen.' : 'Mobilen overtar kamera og mikrofon.'}</span>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setKeepCam(null)}>Endre</button>
          </p>
          <div className="phone__qr" aria-live="polite">
            {error ? <p className="phone__err">{error}</p>
              : svg ? <span dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label="QR-kode som åpner setet ditt på mobilen" />
                : <span className="phone__wait">Lager QR-kode …</span>}
          </div>
          <p className="field__hint">
            Skann med mobilkameraet. Koden kan brukes én gang og er gyldig i fem minutter.
            {local && <><br /><b>Mobilen kan ikke åpne denne siden via localhost.</b> Åpne først siden med datamaskinens nettverksadresse.</>}
          </p>
        </>
      )}
      <div className="sheet__actions">
        <button type="button" className="btn btn--quiet" onClick={onClose}>Lukk</button>
      </div>
    </div>
  );
}
