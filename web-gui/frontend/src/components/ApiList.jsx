import ApiCard from './ApiCard';

export default function ApiList({ apis, loading, onViewDetails, onDelete, onForceClear }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Card header */}
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-800">Provisioned APIs</h2>
          <p className="text-xs text-gray-500 mt-1">All APIs created through this portal</p>
        </div>
        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">
          {apis.length}
        </span>
      </div>

      <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
        {loading ? (
          <EmptyState icon="spinner" text="Loading APIs..." />
        ) : apis.length === 0 ? (
          <EmptyState icon="empty" text="No APIs provisioned yet" />
        ) : (
          [...apis]
            .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
            .map(api => (
              <ApiCard
                key={api.api_name}
                api={api}
                onViewDetails={() => onViewDetails(api.api_name)}
                onDelete={() => onDelete(api.api_name)}
                onForceClear={() => onForceClear(api.api_name)}
              />
            ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div className="p-8 text-center text-gray-400 text-sm">
      {icon === 'spinner' ? (
        <svg className="animate-spin w-8 h-8 mx-auto mb-2 text-gray-300" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
      ) : (
        <svg className="w-8 h-8 mx-auto mb-2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      )}
      {text}
    </div>
  );
}

