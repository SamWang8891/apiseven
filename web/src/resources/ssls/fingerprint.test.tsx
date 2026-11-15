// The fingerprint on a page the browser does not count as secure (plain http on a LAN address), where
// it offers no crypto.subtle: the line says why there is none, not a bare dash (Task 16b, item 97).
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { SEED_CERT } from '../../test/sslSeed';
import { CertDetails } from './CertDetails';
import { fingerprintOf } from './fingerprint';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the SHA-256 fingerprint', () => {
  it('without crypto.subtle (not a secure context) says it needs HTTPS or localhost', async () => {
    vi.stubGlobal('crypto', {});
    expect(await fingerprintOf(SEED_CERT)).toBeUndefined();
    render(<CertDetails pem={SEED_CERT} />);
    expect(screen.getByRole('definition', { name: t('ssl.cert.fingerprint') })).toHaveTextContent(t('ssl.cert.fingerprintInsecure'));
  });
});
