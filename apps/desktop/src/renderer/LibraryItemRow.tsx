import type { AccountView, LibraryItem, PluginInstallRecipe } from '../shared/api';
import { useI18n } from './I18nContext';
import { itemDetail } from './library-state';
import { LibraryPluginInstall, type RunCommand } from './LibraryPluginInstall';
import { Switch } from './settings-controls';
import './library.css';

interface LibraryItemRowProps {
  item: LibraryItem;
  recipe: PluginInstallRecipe | undefined;
  accounts: readonly AccountView[];
  pending: boolean;
  onToggle: (item: LibraryItem, enabled: boolean) => void;
  onEdit: (item: LibraryItem) => void;
  onRemove: (item: LibraryItem) => void;
  onRun: RunCommand;
}

export function LibraryItemRow(props: LibraryItemRowProps) {
  const { item, recipe, accounts, pending, onToggle, onEdit, onRemove, onRun } = props;
  const { t } = useI18n();
  const switchId = `library-item-${item.id}`;
  const detail = itemDetail(item);

  return (
    <li className="library-row">
      <div className="library-row-main">
        <div className="library-row-text">
          <label className="library-row-name" htmlFor={switchId}>
            {item.name}
          </label>
          {item.description ? <span className="library-row-desc">{item.description}</span> : null}
          {detail !== '' ? <span className="library-row-detail mono">{detail}</span> : null}
        </div>
        <div className="library-row-actions">
          <span className="library-row-state">
            {item.enabled ? t('library.state.on') : t('library.state.off')}
          </span>
          <Switch
            id={switchId}
            checked={item.enabled}
            disabled={pending}
            onChange={(enabled) => onToggle(item, enabled)}
          />
          <button
            type="button"
            className="btn btn-sm"
            aria-label={t('library.editAria', { name: item.name })}
            onClick={() => onEdit(item)}
          >
            {t('library.edit')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            aria-label={t('library.removeAria', { name: item.name })}
            onClick={() => onRemove(item)}
          >
            {t('library.remove')}
          </button>
        </div>
      </div>
      {item.kind === 'plugin' ? (
        <LibraryPluginInstall item={item} recipe={recipe} accounts={accounts} onRun={onRun} />
      ) : null}
    </li>
  );
}
