import { useState } from 'react';

const API_TYPES = [
  { value: 'http-public',     label: '🌐 HTTP Public — No auth (public endpoint)',             desc: 'No authentication — anyone can call this endpoint' },
  { value: 'http-jwt',        label: '🔐 HTTP JWT — Cognito token (customer portal)',          desc: 'Cognito IdToken required — reuses existing User Pool' },
  { value: 'http-custom-key', label: '🔑 HTTP Custom Key — X-Api-Key header (B2B partner)',   desc: 'X-Api-Key header validated by the existing Lambda authorizer' },
  { value: 'http-iam',        label: '🛡️ HTTP IAM — AWS SigV4 (internal service)',            desc: 'AWS SigV4 signing required — for internal AWS services only' },
  { value: 'rest-usage-plan', label: '📊 REST Usage Plan — per-partner quota (rate limiting)', desc: 'REST API v1 with per-partner daily quota enforced natively by AWS' },
];

const HTTP_METHODS  = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const ENVIRONMENTS  = ['dev', 'sit', 'stage', 'prod'];
const INITIAL_FORM  = {
  api_name: '', api_type: '', http_method: 'GET', route_path: '/data',
  environment: 'dev', partner_name: '', quota_per_day: 5000, rate_limit_per_second: 50,
};

export default function CreateApiForm({ onSubmit, onError }) {
  const [form, setForm]       = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(false);

  const isRestApi = form.api_type === 'rest-usage-plan';
  const apiDesc   = API_TYPES.find(t => t.value === form.api_type)?.desc ?? '';

  const set = (field) => (e) =>
    setForm(f => ({ ...f, [field]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit({
        api_name:              form.api_name.trim(),
        api_type:              form.api_type,
        http_method:           form.http_method,
        route_path:            form.route_path.trim(),
        environment:           form.environment,
        partner_name:          isRestApi ? form.partner_name || 'partner' : undefined,
        quota_per_day:         isRestApi ? form.quota_per_day : undefined,
        rate_limit_per_second: isRestApi ? form.rate_limit_per_second : undefined,
      });
      setForm(INITIAL_FORM);
    } catch (err) {
      onError(`${err.message}${err.details ? ': ' + JSON.stringify(err.details) : ''}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Card header */}
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
        <h2 className="font-semibold text-gray-800">Create New API</h2>
        <p className="text-xs text-gray-500 mt-1">Provisions a new API Gateway with the selected auth type</p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5">

        {/* API Name */}
        <Field label="API Name *" hint="Unique identifier — used as AWS resource prefix">
          <input
            type="text" value={form.api_name} onChange={set('api_name')} required
            placeholder="e.g. payments, partner-hsbc"
            pattern="[a-z][a-z0-9\-]{2,28}[a-z0-9]"
            title="Lowercase letters, numbers, hyphens (4-30 chars)"
            className={input}
          />
        </Field>

        {/* API Type */}
        <Field label="API Type *" hint={apiDesc}>
          <select value={form.api_type} onChange={set('api_type')} required className={input}>
            <option value="">Select auth type...</option>
            {API_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>

        {/* Method + Route */}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Method *">
            <select value={form.http_method} onChange={set('http_method')} required className={input}>
              {HTTP_METHODS.map(m => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Route Path *">
              <input
                type="text" value={form.route_path} onChange={set('route_path')} required
                placeholder="/payments"
                className={input}
              />
            </Field>
          </div>
        </div>

        {/* Environment */}
        <Field label="Environment *">
          <select value={form.environment} onChange={set('environment')} required className={input}>
            {ENVIRONMENTS.map(e => <option key={e}>{e}</option>)}
          </select>
        </Field>

        {/* REST API usage plan fields — only shown for rest-usage-plan */}
        {isRestApi && (
          <div className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-100 fade-in">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
              REST API — Usage Plan Settings
            </p>
            <Field label="Partner Name">
              <input
                type="text" value={form.partner_name} onChange={set('partner_name')}
                placeholder="e.g. hsbc, barclays"
                className={input}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quota / Day">
                <input type="number" value={form.quota_per_day} onChange={set('quota_per_day')} min={1} className={input} />
              </Field>
              <Field label="Rate (req/s)">
                <input type="number" value={form.rate_limit_per_second} onChange={set('rate_limit_per_second')} min={1} className={input} />
              </Field>
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Creating...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create API
            </>
          )}
        </button>
      </form>
    </div>
  );
}

// Shared field wrapper
function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';

