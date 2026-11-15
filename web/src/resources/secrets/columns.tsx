// The secrets list columns: the id as plugins name it (<manager>/<id>), the manager, where it reads
// from, and when it changed. No credential is ever shown here.
import type { Item } from '../../api/types';
import { isObj } from '../../api/sanitize';
import { t } from '../../i18n';
import { NameCell } from '../../table/cells';
import { Badge } from '../../ui';
import type { ColumnDef } from '../registry';
import { timeColumns } from '../timeColumns';
import { isManager, splitSecretId } from './schemas';

/** The manager part of the id ("vault"), as stored. */
export const managerName = (item: Item): string => splitSecretId(item.id).manager;

/**
 * Where an entry reads secrets from: a vault's `uri`, an AWS region (and endpoint, when set; the
 * region's default is us-east-1, aws.lua 45–48), a GCP project or the file it is read from.
 */
export function endpointOf(item: Item): string | undefined {
  const v = item.value;
  const text = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined);
  switch (managerName(item)) {
    case 'vault':
      return text(v.uri);
    case 'aws': {
      const region = text(v.region) ?? 'us-east-1';
      const endpoint = text(v.endpoint_url);
      return endpoint ? `${region} · ${endpoint}` : region;
    }
    case 'gcp':
      return text(isObj(v.auth_config) ? v.auth_config.project_id : undefined) ?? text(v.auth_file);
    default:
      return undefined;
  }
}

export const secretColumns: ColumnDef[] = [
  {
    id: 'id',
    get header() {
      return t('column.id');
    },
    accessor: (item) => item.id,
    cell: (item) => <NameCell kind="secrets" item={item} value={item.id} mono />,
    defaultVisible: true,
    width: 240,
    mono: true,
  },
  {
    id: 'manager',
    get header() {
      return t('column.manager');
    },
    accessor: (item) => managerName(item),
    cell: (item) => {
      const manager = managerName(item);
      return <Badge tone={isManager(manager) ? 'neutral' : 'warn'}>{isManager(manager) ? t(`sc.manager.${manager}`) : manager}</Badge>;
    },
    defaultVisible: true,
    width: 180,
  },
  {
    id: 'endpoint',
    get header() {
      return t('column.endpoint');
    },
    accessor: endpointOf,
    defaultVisible: true,
    width: 320,
    mono: true,
  },
  ...timeColumns(),
];
