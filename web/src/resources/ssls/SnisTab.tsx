// The SSL editor's SNIs tab (fields sni, snis): the host names the certificate is presented for,
// written like a route's hosts (one in `sni`, several in `snis`: writePair), and "Use SANs from
// certificate", which takes the certificate's DNS names (an IP address SAN is not a name a client
// sends). Typed names are checked against the schema's pattern, and a wildcard that isn't `*.` is
// refused as it is typed (the router would match it oddly: "*foo.test" covers "foo.test" and
// "xfoo.test"). A note names the other certificates with one of these SNIs: APISIX presents the one
// it loaded first.
import { issuesUnder } from '../../editor/issues';
import { t } from '../../i18n';
import { Button, TagInput, useLocked } from '../../ui';
import type { TabProps } from '../registry';
import { servedToClients, sniList } from '../resolve';
import { readPair, writePair } from '../routes/pairs';
import { sniProblem } from './pem';
import { parseCert } from './parseCert';
import { certOf, typeOf } from './usage';
import { isSecretRef } from './validate';

/**
 * What the SNIs tab says about the certificate's names: them, or that it names none, only when our
 * reader read it; for a reference or a certificate it can't read, that the names aren't known here;
 * nothing before there is a certificate.
 */
function sansNoteOf(cert: unknown, dns: string[]): string | undefined {
  if (typeof cert !== 'string' || cert.trim() === '') return undefined;
  if (isSecretRef(cert.trim())) return t('ssl.snis.sansRef');
  if (!parseCert(cert)) return t('ssl.snis.sansUnreadable');
  return dns.length > 0 ? t('ssl.snis.sansNote', { names: dns.join(', ') }) : t('ssl.snis.noSans');
}

export function SnisTab({ draft, setDraft, issues, ctx, original }: TabProps) {
  const locked = useLocked();
  const snis = readPair(draft, 'sni', 'snis');
  const error = [...issuesUnder(issues, 'sni'), ...issuesUnder(issues, 'snis')][0]?.message;
  const dns = certOf(draft)?.dns ?? [];
  const sansNote = sansNoteOf(draft.cert, dns);
  const client = typeOf(draft) === 'client';
  // Other enabled server certificates with one of these SNIs, once the list has loaded.
  const own = new Set(sniList(draft));
  const others = ctx.loaded.ssls && servedToClients(draft)
    ? ctx.ssls.filter((item) => item.id !== original?.id && servedToClients(item.value) && sniList(item.value).some((sni) => own.has(sni)))
    : [];
  return (
    <div className="ed-stack ssl-tab">
      <TagInput
        label={t('ssl.snis.label')}
        fieldName={t('ssl.snis.label')}
        mono
        help={locked ? undefined : t('ssl.snis.help')}
        error={error}
        value={snis}
        validate={sniProblem}
        onChange={(next) => setDraft(writePair(draft, 'sni', 'snis', next))}
      />
      {!locked && (
        <div className="ssl-sans">
          <span>
            <Button size="sm" disabled={dns.length === 0} onClick={() => setDraft(writePair(draft, 'sni', 'snis', [...new Set(dns)]))}>
              {t('ssl.snis.useSans')}
            </Button>
          </span>
          {sansNote && <span className="ed-note">{sansNote}</span>}
        </div>
      )}
      {client && <p className="ed-note">{t('ssl.snis.clientNote')}</p>}
      {!client && others.length > 0 && (
        <p className="ssl-warn" role="note">
          {t('ssl.snis.shared', { names: others.map((item) => item.id).join(', ') })}
        </p>
      )}
    </div>
  );
}
