import { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import CreateApiForm from './components/CreateApiForm';
import ApiList from './components/ApiList';
import ApiDetailModal from './components/ApiDetailModal';
import Toast from './components/Toast';
import { api } from './api';

export default function App() {
  const [apis, setApis]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [selectedApi, setSelectedApi] = useState(null);
  const [toast, setToast]             = useState(null); // { message, type: 'success'|'error' }

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const loadApis = useCallback(async () => {
    try {
      const data = await api.listApis();
      setApis(data.apis ?? []);
    } catch (e) {
      console.error('Failed to load APIs:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-refresh every 30s
  useEffect(() => {
    loadApis();
    const interval = setInterval(loadApis, 30000);
    return () => clearInterval(interval);
  }, [loadApis]);

  const handleCreate = async (formData) => {
    const data = await api.createApi(formData); // throws on error
    showToast(`✅ ${data.message}`);
    loadApis();
    return data;
  };

  const handleDelete = async (apiName) => {
    if (!confirm(`Delete '${apiName}'?\n\nThis permanently removes all AWS resources.`)) return;
    try {
      await api.deleteApi(apiName);
      showToast(`🗑️ '${apiName}' deleted successfully`);
      if (selectedApi?.api_name === apiName) setSelectedApi(null);
      loadApis();
    } catch (e) {
      showToast(`Delete failed: ${e.message}`, 'error');
    }
  };

  const handleViewDetails = async (apiName) => {
    try {
      const data = await api.getApi(apiName);
      setSelectedApi(data);
    } catch (e) {
      showToast(`Failed to load details: ${e.message}`, 'error');
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <Header onRefresh={loadApis} />

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <CreateApiForm onSubmit={handleCreate} onError={(msg) => showToast(msg, 'error')} />
        <ApiList
          apis={apis}
          loading={loading}
          onRefresh={loadApis}
          onViewDetails={handleViewDetails}
          onDelete={handleDelete}
        />
      </main>

      {selectedApi && (
        <ApiDetailModal api={selectedApi} onClose={() => setSelectedApi(null)} />
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

