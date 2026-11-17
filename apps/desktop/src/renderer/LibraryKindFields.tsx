import type { ProviderId } from '@inova/core/types';
import { useI18n } from './I18nContext';
import type { LibraryFormState, McpTransport } from './library-form';
import { KeyValueFields } from './LibraryKeyValueFields';
import { PlatformSelect } from './PlatformSelect';
import { PROVIDER_NAME } from './provider-meta';
import { Segmented } from './settings-controls';
import './library.css';

interface KindFieldsProps {
  form: LibraryFormState;
  onChange: (patch: Partial<LibraryFormState>) => void;
}

const PROVIDER_OPTIONS = (Object.keys(PROVIDER_NAME) as ProviderId[]).map((provider) => ({
  value: provider,
  label: PROVIDER_NAME[provider],
}));

export function TextField(props: {
  id: string;
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { id, label, value, hint, mono = false, disabled = false, onChange } = props;
  return (
    <div className="modal-field">
      <label className="modal-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        className={mono ? 'field mono' : 'field'}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <p id={`${id}-hint`} className="library-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SkillFields({ form, onChange }: KindFieldsProps) {
  const { t } = useI18n();
  const replacing = form.editing && form.skillContent.trim() !== '';
  const note = form.editing
    ? replacing
      ? t('library.form.skillReplace')
      : t('library.form.skillKeep')
    : t('library.form.skillHint');
  return (
    <div className="modal-field">
      <label className="modal-field-label" htmlFor="library-form-skill">
        {t('library.form.skillContent')}
      </label>
      <textarea
        id="library-form-skill"
        className="field library-textarea mono"
        rows={10}
        value={form.skillContent}
        spellCheck={false}
        aria-describedby="library-form-skill-note"
        onChange={(event) => onChange({ skillContent: event.target.value })}
      />
      <p
        id="library-form-skill-note"
        className="library-hint"
        role={replacing ? 'status' : undefined}
      >
        {note}
      </p>
    </div>
  );
}

function TransportField(props: {
  value: McpTransport;
  options: readonly McpTransport[];
  onChange: (value: McpTransport) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="modal-field">
      <span className="modal-field-label">{t('library.form.transport')}</span>
      <Segmented
        name="library-transport"
        label={t('library.form.transport')}
        value={props.value}
        options={props.options.map((option) => ({ value: option, label: option }))}
        onChange={props.onChange}
      />
    </div>
  );
}

function RemoteFields({ form, onChange }: KindFieldsProps) {
  const { t } = useI18n();
  return (
    <>
      <TextField
        id="library-form-url"
        label={t('library.form.url')}
        value={form.url}
        mono
        onChange={(url) => onChange({ url })}
      />
      <KeyValueFields
        title={t('library.form.headers')}
        addLabel={t('library.form.addHeader')}
        rows={form.headers}
        onChange={(headers) => onChange({ headers })}
      />
    </>
  );
}

function McpFields({ form, onChange }: KindFieldsProps) {
  const { t } = useI18n();
  return (
    <>
      <TransportField
        value={form.transport}
        options={['stdio', 'http', 'sse']}
        onChange={(transport) => onChange({ transport })}
      />
      {form.transport === 'stdio' ? (
        <>
          <TextField
            id="library-form-command"
            label={t('library.form.command')}
            value={form.command}
            mono
            onChange={(command) => onChange({ command })}
          />
          <div className="modal-field">
            <label className="modal-field-label" htmlFor="library-form-args">
              {t('library.form.args')}
            </label>
            <textarea
              id="library-form-args"
              className="field library-textarea mono"
              rows={3}
              value={form.args}
              spellCheck={false}
              onChange={(event) => onChange({ args: event.target.value })}
            />
          </div>
          <KeyValueFields
            title={t('library.form.env')}
            addLabel={t('library.form.addEnv')}
            rows={form.env}
            onChange={(env) => onChange({ env })}
          />
        </>
      ) : (
        <RemoteFields form={form} onChange={onChange} />
      )}
    </>
  );
}

function ConnectorFields({ form, onChange }: KindFieldsProps) {
  const { t } = useI18n();
  return (
    <>
      <TextField
        id="library-form-label"
        label={t('library.form.label')}
        value={form.label}
        onChange={(label) => onChange({ label })}
      />
      <TransportField
        value={form.transport}
        options={['http', 'sse']}
        onChange={(transport) => onChange({ transport })}
      />
      <RemoteFields form={form} onChange={onChange} />
    </>
  );
}

function PluginFields({ form, onChange }: KindFieldsProps) {
  const { t } = useI18n();
  return (
    <>
      <div className="modal-field">
        <span className="modal-field-label">{t('library.form.provider')}</span>
        <PlatformSelect
          ariaLabel={t('library.form.provider')}
          value={form.provider}
          options={PROVIDER_OPTIONS}
          onChange={(provider) => onChange({ provider: provider as ProviderId })}
        />
      </div>
      <TextField
        id="library-form-marketplace"
        label={t('library.form.marketplace')}
        value={form.marketplace}
        mono
        onChange={(marketplace) => onChange({ marketplace })}
      />
      <TextField
        id="library-form-plugin-name"
        label={t('library.form.pluginName')}
        value={form.pluginName}
        mono
        onChange={(pluginName) => onChange({ pluginName })}
      />
    </>
  );
}

export function KindFields({ form, onChange }: KindFieldsProps) {
  switch (form.kind) {
    case 'skill':
      return <SkillFields form={form} onChange={onChange} />;
    case 'mcp':
      return <McpFields form={form} onChange={onChange} />;
    case 'connector':
      return <ConnectorFields form={form} onChange={onChange} />;
    case 'plugin':
      return <PluginFields form={form} onChange={onChange} />;
  }
}
