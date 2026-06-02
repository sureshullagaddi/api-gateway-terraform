/**
 * api.js — all HTTP calls to the backend Lambda.
 * API endpoint is injected at runtime via window.__CONFIG__ (from config.js in S3).
 * Falls back to VITE env var for local development.
 */

const BASE_URL =
  window.__CONFIG__?.apiEndpoint ||
  import.meta.env.VITE_API_ENDPOINT ||
  'http://localhost:3000';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Request failed'), { details: data.details, status: res.status });
  return data;
}

export const api = {
  /** Create a new API */
  createApi: (body)     => request('/apis', { method: 'POST', body: JSON.stringify(body) }),
  /** List all provisioned APIs */
  listApis:  ()         => request('/apis'),
  /** Get one API by name */
  getApi:    (apiName)  => request(`/apis/${apiName}`),
  /** Delete an API and all its AWS resources */
  deleteApi: (apiName)  => request(`/apis/${apiName}`, { method: 'DELETE' }),
};

