import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { call } from '../lib/socket';

/** QR code that moves your seat to a phone, with a choice of where the camera stays. */
export function PhoneSheet({ tableId, camOn, onClose }: { tableId: string; camOn: boolean; onClose: () => void }) {
  const [keepCam, setKeepCam] = useState(true);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  useEffect(() => {
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
      <h2 className="sheet__title">Continue on your phone</h2>
      <div className="phone__choice" role="radiogroup" aria-label="Camera">
        <button type="button" role="radio" aria-checked={keepCam} className={keepCam ? 'is-on' : ''} onClick={() => setKeepCam(true)}>
          <b>Camera stays here</b>
          <span>Play from the phone, this computer keeps showing your face{camOn ? '' : ' (turn the camera on here)'}.</span>
        </button>
        <button type="button" role="radio" aria-checked={!keepCam} className={!keepCam ? 'is-on' : ''} onClick={() => setKeepCam(false)}>
          <b>Move everything</b>
          <span>The phone takes over camera and mic. This screen steps aside.</span>
        </button>
      </div>
      <div className="phone__qr" aria-live="polite">
        {error ? <p className="phone__err">{error}</p>
          : svg ? <span dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label="QR code that opens your seat on a phone" />
            : <span className="phone__wait">Making a code…</span>}
      </div>
      <p className="field__hint">
        Scan with the phone camera. The code works once and lasts 5 minutes.
        {local && <><br /><b>This page is on localhost, which a phone cannot open.</b> Open it with the computer's network address first.</>}
      </p>
      <div className="sheet__actions">
        <button type="button" className="btn btn--quiet" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
