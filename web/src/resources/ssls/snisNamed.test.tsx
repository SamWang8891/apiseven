// The SNIs tab names the SNIs its certificate does not cover (Task 16 B21): clients sent to them are
// shown a certificate that doesn't name them. A note, never a hold; nothing when the certificate's
// names aren't known here (a reference, a certificate our reader can't read, none yet), and nothing
// for a client certificate, which no TLS client is shown.
import { screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { itemOf } from '../../test/ctx';
import { SEED_CERT } from '../../test/sslSeed';
import { renderTab } from '../../test/tab';
import { fingerprintOf } from './fingerprint';
import { SnisTab } from './SnisTab';
import { sslIssues } from './validate';

beforeAll(async () => {
  await fingerprintOf(SEED_CERT);
});

const renderSnis = (draft: Obj, opts: Parameters<typeof renderTab>[4] = {}) => renderTab('ssls', SnisTab, draft, sslIssues, { original: itemOf('s1', draft), ...opts });
const note = (names: string) => t('ssl.snis.notNamed', { names });

describe('SNIs the certificate does not name', () => {
  it('names them (the seed names apiseven.test and *.apiseven.test), as clients match: one label under a wildcard', () => {
    renderSnis({ cert: SEED_CERT, snis: ['apiseven.test', 'Api.ApiSeven.test', 'other.test', 'a.b.apiseven.test', '*.apiseven.test'] });
    expect(screen.getByText(note('other.test, a.b.apiseven.test'))).toBeInTheDocument();
  });

  it('a note, never a hold: nothing held, Use SANs works as before, and the note goes once every SNI is named', async () => {
    const draft = { cert: SEED_CERT, sni: 'elsewhere.test' };
    const { user, held, value, lock } = renderSnis(draft);
    expect(screen.getByText(note('elsewhere.test'))).toBeInTheDocument();
    expect(held()).toEqual([]);
    await user.click(screen.getByRole('button', { name: t('ssl.snis.useSans') }));
    expect(value()).toEqual({ cert: SEED_CERT, snis: ['apiseven.test', '*.apiseven.test'] });
    expect(screen.queryByText(/does not name/)).toBeNull();
    lock(true);
    expect(screen.queryByText(/does not name/)).toBeNull();
  });

  it('shown on a locked page too', () => {
    renderSnis({ cert: SEED_CERT, sni: 'elsewhere.test' }, { locked: true });
    expect(screen.getByText(note('elsewhere.test'))).toBeInTheDocument();
  });

  it.each([
    ['a reference', { cert: '$secret://vault/1/cert', sni: 'elsewhere.test' }],
    ['an unreadable certificate', { cert: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(200)}\n-----END CERTIFICATE-----`, sni: 'elsewhere.test' }],
    ['no certificate yet', { sni: 'elsewhere.test' }],
    ['a client certificate', { type: 'client', cert: SEED_CERT, sni: 'elsewhere.test' }],
    ['every SNI named', { cert: SEED_CERT, snis: ['apiseven.test', 'x.apiseven.test'] }],
  ])('nothing for %s', (_, draft) => {
    const { container } = renderSnis(draft);
    expect(container).not.toHaveTextContent(/does not name/);
  });
});
