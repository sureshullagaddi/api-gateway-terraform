export default function ApiDetailModal({ api, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto fade-in">

        {/* Modal header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">{api.api_name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal body */}
        <div className="p-6 space-y-4 text-sm">

          {/* Key-value grid */}
          <div className="grid grid-cols-2 gap-y-2 gap-x-4">
            <InfoRow label="API Type"    value={api.api_type} />
            <InfoRow label="Status"      value={api.status} />
            <InfoRow label="Environment" value={api.environment} />
            <InfoRow label="Method"      value={`${api.http_method} ${api.route_path}`} />
            {api.partner_name && <InfoRow label="Partner" value={api.partner_name} />}
          </div>

          {/* Endpoint URL */}
          {api.route_url && (
            <div>
              <p className="text-gray-500 mb-1 font-medium">Endpoint</p>
              <code className="block bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs break-all select-all">
                {api.route_url}
              </code>
            </div>
          )}

          {/* Test hint */}
          {api.test_hint && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <p className="text-blue-700 text-xs font-semibold mb-1">How to test</p>
              <p className="text-blue-600 text-xs">{api.test_hint}</p>
            </div>
          )}

          {/* Timestamps */}
          <div className="pt-2 border-t border-gray-100 text-xs text-gray-400 space-y-0.5">
            {api.created_at && <p>Created: {new Date(api.created_at).toLocaleString()}</p>}
            {api.updated_at && <p>Updated: {new Date(api.updated_at).toLocaleString()}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <span className="text-gray-500">{label}: </span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  );
}

