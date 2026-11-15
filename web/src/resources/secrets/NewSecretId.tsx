// A new secret's id, above the tabs (ResourceDef.NewId): the manager it is stored under, picked from
// the three APISIX has, and the id after it. The frame gets "<manager>/<id>" (the client sends it as
// two path segments: PUT /secrets/vault/my-id), and refuses what APISIX can't take as it is
// (secretIdProblem). Switching from one manager to another clears what was entered for the first:
// the managers take different settings; it asks first when there is something to clear.
import { useState } from 'react';
import { t } from '../../i18n';
import { ConfirmDialog, Input, Select } from '../../ui';
import type { NewIdProps } from '../registry';
import { isManager, MANAGERS, splitSecretId, type Manager } from './schemas';
import '../resources.css';

export function NewSecretId({ value, onChange, draft, setDraft, error, inputRef }: NewIdProps) {
  const { manager, name } = splitSecretId(value);
  /** View state: a switch of manager waiting for the user's yes. */
  const [asking, setAsking] = useState<Manager>();
  const emit = (m: string, n: string) => onChange(m === '' && n === '' ? '' : `${m}/${n}`);
  const switchTo = (next: Manager) => {
    setAsking(undefined);
    emit(next, name);
    setDraft({});
  };
  const choose = (next: string | undefined) => {
    if (!isManager(next) || next === manager) return;
    const entered = Object.keys(draft).some((key) => key !== 'id');
    if (isManager(manager) && entered) setAsking(next);
    else if (isManager(manager)) switchTo(next);
    else emit(next, name);
  };
  return (
    <div className="res-newid">
      <Select
        label={t('sc.manager.label')}
        required
        value={isManager(manager) ? manager : undefined}
        onChange={choose}
        placeholder={t('sc.manager.placeholder')}
        options={MANAGERS.map((m) => ({ value: m, label: t(`sc.manager.${m}`), description: m }))}
        monoDescription
      />
      <Input
        ref={inputRef}
        label={t('sc.id.label')}
        required
        mono
        value={name}
        onChange={(e) => emit(manager, e.target.value)}
        help={isManager(manager) ? t('sc.id.help', { manager }) : t('sc.id.chooseFirst')}
        error={error}
      />
      {asking && isManager(manager) && (
        <ConfirmDialog
          open
          title={t('editor.switchId.title', { to: t(`sc.manager.${asking}`) })}
          body={<p>{t('editor.switchId.body', { from: t(`sc.manager.${manager}`), to: t(`sc.manager.${asking}`) })}</p>}
          confirmLabel={t('editor.switchId.confirm')}
          onConfirm={() => switchTo(asking)}
          onCancel={() => setAsking(undefined)}
        />
      )}
    </div>
  );
}
