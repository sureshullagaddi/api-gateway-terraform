const STATUS_STYLES = {
  ACTIVE:       'bg-green-100 text-green-700',
  CREATING:     'bg-yellow-100 text-yellow-700',
  FAILED:       'bg-red-100 text-red-700',
  DELETING:     'bg-orange-100 text-orange-700',
  DELETE_FAILED:'bg-red-100 text-red-700',
};

export default function ApiCard({ api, onViewDetails, onDelete }) {
  const statusStyle = STATUS_STYLES[api.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="p-4 hover:bg-gray-50 transition-colors fade-in">
      <div className="flex items-start justify-between gap-2">

        {/* Left: info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{api.api_name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle}`}>
              {api.status}
            </span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {api.environment}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {api.api_type} · {api.http_method} {api.route_path}
          </p>
          {api.route_url && (
            <p className="text-xs text-blue-600 mt-1 truncate">{api.route_url}</p>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onViewDetails}
            className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            Details
          </button>
          <button
            onClick={onDelete}
            disabled={api.status === 'DELETING'}
            className="text-xs px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

