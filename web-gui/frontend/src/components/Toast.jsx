export default function Toast({ message, type = 'success' }) {
  const styles = {
    success: 'bg-green-50 text-green-800 border-green-200',
    error:   'bg-red-50 text-red-800 border-red-200',
  };

  return (
    <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium max-w-sm fade-in ${styles[type]}`}>
      {message}
    </div>
  );
}

