import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { call } from '../lib/socket';
import { PhoneSheet } from './PhoneSheet';

describe('PhoneSheet', () => {
  it('asks where the camera stays before making a QR code', () => {
    vi.mocked(call).mockClear();
    render(<PhoneSheet tableId="abc" camOn onClose={vi.fn()} />);
    expect(call).not.toHaveBeenCalled();
    expect(screen.queryByText(/Lager QR-kode/)).toBeNull();

    fireEvent.click(screen.getByText('Flytt alt til mobilen'));
    expect(call).toHaveBeenCalledWith('handoff:create', { keepCam: false });
    expect(screen.getByText(/Lager QR-kode/)).toBeTruthy();
    expect(screen.queryByText('Behold kameraet her')).toBeNull();

    fireEvent.click(screen.getByText('Endre'));
    fireEvent.click(screen.getByText('Behold kameraet her'));
    expect(call).toHaveBeenLastCalledWith('handoff:create', { keepCam: true });
  });
});
