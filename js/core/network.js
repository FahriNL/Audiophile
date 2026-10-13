/**
 * network.js - Centralized privacy and network gatekeeper for Audiophile
 *
 * Ensures all outbound external network requests pass through user-configurable
 * privacy permission checks. Defaults to disabled for any services sending
 * collection-derived information (artist and album names).
 */

import { settings } from './settings.js';

export const EXTERNAL_SERVICES = {
  deezer: {
    id: 'deezer',
    name: 'Deezer API',
    purpose: 'Mengambil foto profil artis resolusi tinggi dan perkiraan jumlah penggemar.',
    dataSent: 'Nama artis yang dicari.',
    defaultEnabled: false
  },
  musicbrainz: {
    id: 'musicbrainz',
    name: 'MusicBrainz API',
    purpose: 'Mengambil metadata negara asal artis, jenis artis, dan tag genre musik resmi.',
    dataSent: 'Nama artis yang dicari.',
    defaultEnabled: false
  },
  wikipedia: {
    id: 'wikipedia',
    name: 'Wikipedia REST API',
    purpose: 'Mengambil ringkasan biografi singkat artis dan pranala ensiklopedia.',
    dataSent: 'Nama artis atau judul artikel.',
    defaultEnabled: false
  },
  wikimedia: {
    id: 'wikimedia',
    name: 'Wikimedia Commons API',
    purpose: 'Mencari foto panggung konser lanskap beresolusi tinggi untuk banner hero artis.',
    dataSent: 'Kata kunci nama artis dan panggung konser.',
    defaultEnabled: false
  },
  itunes: {
    id: 'itunes',
    name: 'iTunes Search API',
    purpose: 'Mengambil artwork cover album resmi (1200x1200px) jika berkas lokal tidak memiliki gambar sampul.',
    dataSent: 'Nama artis dan nama album musik.',
    defaultEnabled: false
  }
};

/**
 * Check if master Total Offline Mode is currently enabled
 * @returns {boolean}
 */
export function isTotalOffline() {
  return Boolean(settings.get('privacy.totalOffline', false));
}

/**
 * Check if a specific external service is permitted by the user
 * @param {string} serviceId
 * @returns {boolean}
 */
export function isServiceAllowed(serviceId) {
  if (isTotalOffline()) return false;
  return Boolean(settings.get(`privacy.services.${serviceId}`, false));
}

/**
 * Determine permission status with descriptive details for UI placeholders
 * @param {string} serviceId
 * @returns {{ allowed: boolean, reason: 'ok'|'total_offline'|'service_disabled'|'unknown_service', service?: Object }}
 */
export function canAccessService(serviceId) {
  const service = EXTERNAL_SERVICES[serviceId];
  if (!service) {
    return { allowed: false, reason: 'unknown_service' };
  }
  if (isTotalOffline()) {
    return { allowed: false, reason: 'total_offline', service };
  }
  if (!settings.get(`privacy.services.${serviceId}`, false)) {
    return { allowed: false, reason: 'service_disabled', service };
  }
  return { allowed: true, reason: 'ok', service };
}

/**
 * Single gatekeeper wrapper for all outbound HTTP/HTTPS requests
 * @param {string} serviceId
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function externalFetch(serviceId, url, options = {}) {
  const status = canAccessService(serviceId);
  if (!status.allowed) {
    const error = new Error(
      status.reason === 'total_offline'
        ? 'Mode Offline Total aktif. Semua permintaan jaringan eksternal diblokir.'
        : `Layanan eksternal "${serviceId}" dinonaktifkan di Pengaturan Privasi.`
    );
    error.serviceBlocked = true;
    error.serviceId = serviceId;
    error.reason = status.reason;
    throw error;
  }

  return fetch(url, options);
}

/**
 * Return all registered external services as a list
 * @returns {Array<Object>}
 */
export function getRegisteredServices() {
  return Object.values(EXTERNAL_SERVICES);
}
