/**
 * healthView.js - Interactive Library Health Dashboard & Non-Destructive Repair Studio
 *
 * Implements LIB-01:
 * - Progressive background audit with IndexedDB caching.
 * - Circular Aurora Glass health score gauge (0-100%) and health grade.
 * - 8 Issue category cards with itemized issue inspect drawers and action buttons.
 * - Non-destructive batch repair preview modal with before/after diff table.
 * - Relink wizard modal for missing tracks matching fingerprint, filename, and size.
 * - Instant Undo capability with multi-level undo stack.
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { healthService } from '../../library/health.js';
import { toast } from '../components/toast.js';
import { escapeHtml, formatFileSize } from '../../core/utils.js';
import { metadataEditor } from '../components/metadataEditor.js';
import { abCompareModal } from '../components/abCompareModal.js';
import { dialog } from '../components/dialog.js';
import { db } from '../../db/db.js';
import { flacConverter } from '../../library/flacConverter.js';
import { folderManager } from '../../library/folders.js';
import { MetadataParser } from '../../library/metadata.js';
import { classifyQualityTier } from '../../quality/tiers.js';
import { getIconSvg } from '../icons.js';
import { t } from '../../core/i18n.js';
import { events } from '../../core/events.js';

class HealthView {
  constructor() {
    this.container = null;
    this.auditData = null;
    this.activeDrawer = null; // 'emptyTags' | 'covers' | 'missingFiles' | 'corruptedFiles' | 'duplicates' | 'inconsistent' | 'scattered' | 'upgrade' | null
    this.previewModalElement = null;
    this.relinkModalElement = null;
    this.isRescanning = false;
  }

  init() {
    this.container = document.getElementById('viewHealth');
    store.subscribe('tracks', () => {
      // Invalidate cached audit when library tracks change
      if (router.getCurrentRoute() === 'health') {
        this.runAuditAndRender();
      } else {
        this.auditData = null;
      }
    });
    events.on('i18n:changed', () => {
      if (router.getCurrentRoute() === 'health') {
        this.render();
      }
    });
  }

  activate() {
    this.runAuditAndRender();
  }

  deactivate() {
    this.closePreviewModal();
    this.closeRelinkModal();
  }

  async runAuditAndRender() {
    if (!this.container) return;

    const tracks = store.get('tracks') || [];

    if (tracks.length === 0) {
      this.renderEmpty();
      return;
    }

    try {
      if (!this.auditData || this.isRescanning) {
        this.renderLoading();
        this.auditData = await healthService.auditLibrary(tracks);
        this.isRescanning = false;
      }
      this.render();
    } catch (err) {
      console.error('Health audit error:', err);
      this.renderError(err);
    }
  }

  renderError(err) {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="padding:60px 20px; text-align:center;">
        <div class="empty-state" style="max-width:520px; margin:0 auto;">
          <div class="empty-state-icon" style="margin-bottom:16px; color:var(--status-danger);">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h2 style="font-size:1.5rem; font-weight:700; color:var(--text-main); margin-bottom:8px;">${escapeHtml(t('health.failedAuditTitle'))}</h2>
          <p style="color:var(--text-muted); font-size:0.9rem; line-height:1.6; margin-bottom:20px;">
            ${t('health.failedAuditDesc', { error: escapeHtml(err?.message || 'Format tidak terbaca') })}
          </p>
          <button class="btn btn-primary" id="btnHealthRetry">
            <span>${escapeHtml(t('common.retry'))}</span>
          </button>
        </div>
      </div>
    `;
    document.getElementById('btnHealthRetry')?.addEventListener('click', () => {
      this.isRescanning = true;
      this.runAuditAndRender();
    });
  }

  renderLoading() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="padding:60px 20px; text-align:center;">
        <div style="display:inline-block; width:48px; height:48px; border:3px solid rgba(255,255,255,0.1); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
        <h3 style="margin-top:16px; font-weight:600; color:var(--text-main);">${escapeHtml(t('health.analyzingTitle'))}</h3>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">
          ${escapeHtml(t('health.analyzingDesc'))}
        </p>
      </div>
    `;
  }

  renderEmpty() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="padding:60px 20px; text-align:center;">
        <div class="empty-state" style="max-width:520px; margin:0 auto;">
          <div class="empty-state-icon" style="margin-bottom:16px;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <h2 style="font-size:1.5rem; font-weight:700; color:var(--text-main); margin-bottom:8px;">${escapeHtml(t('health.emptyLibraryTitle'))}</h2>
          <p style="color:var(--text-muted); font-size:0.9rem; line-height:1.6; margin-bottom:20px;">
            ${escapeHtml(t('health.emptyLibraryDesc'))}
          </p>
          <button class="btn btn-primary" id="btnHealthImportFolder">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span>${escapeHtml(t('health.openMusicFolder'))}</span>
          </button>
        </div>
      </div>
    `;

    document.getElementById('btnHealthImportFolder')?.addEventListener('click', () => {
      folderManager.triggerFolderImport();
    });
  }

  render() {
    if (!this.container || !this.auditData) return;

    const data = this.auditData;
    const { score, grade, categories, totalTracks } = data;
    const canUndo = healthService.canUndo();
    const lastUndoDesc = healthService.getLastUndoDescription();

    // Determine localized score label
    let statusLabel = t('health.scoreAttention');
    if (score >= 90) statusLabel = t('health.scoreExcellent');
    else if (score >= 75) statusLabel = t('health.scoreGood');

    // Determine gauge color
    let scoreColor = 'var(--accent)';
    if (score >= 90) scoreColor = 'var(--status-verified)';
    else if (score >= 75) scoreColor = 'var(--accent-light)';
    else if (score >= 50) scoreColor = 'var(--status-suspect)';
    else scoreColor = 'var(--status-danger)';

    // Circumference for r=46 is 2 * PI * 46 ≈ 289
    const circumference = 289;
    const strokeDashoffset = circumference - (circumference * score) / 100;

    this.container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:24px; padding-bottom:40px;">
        <!-- Header -->
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px;">
          <div>
            <h2 style="font-size:1.8rem; font-weight:800; color:var(--text-main); margin:0; letter-spacing:-0.02em;">
              ${escapeHtml(t('health.healthTitle'))}
            </h2>
            <div style="font-size:0.82rem; color:var(--text-muted); margin-top:4px;">
              ${escapeHtml(t('health.healthSubtitle'))}
            </div>
          </div>

          <div style="display:flex; gap:10px; align-items:center;">
            ${canUndo ? `
              <button class="btn btn-secondary" id="btnHealthUndo" title="${escapeHtml(lastUndoDesc)}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                </svg>
                <span>${escapeHtml(t('health.undoRepair'))}</span>
              </button>
            ` : ''}
            <button class="btn btn-primary" id="btnHealthRescan">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              <span>${escapeHtml(t('health.rescan'))}</span>
            </button>
          </div>
        </div>

        <!-- Undo Banner (if undoable) -->
        ${canUndo ? `
          <div style="background:rgba(59, 130, 246, 0.12); border:1px solid rgba(59, 130, 246, 0.3); border-radius:var(--radius-md); padding:10px 16px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <div style="font-size:0.82rem; color:var(--text-main);">
              <strong>${escapeHtml(t('health.lastRepairSaved'))}</strong> ${escapeHtml(lastUndoDesc)}
              <span style="color:var(--text-dim); margin-left:8px;">${escapeHtml(t('health.originalFileDiskNote'))}</span>
            </div>
            <button class="btn btn-sm btn-secondary" id="btnBannerUndo">${escapeHtml(t('health.undoNow'))}</button>
          </div>
        ` : ''}

        <!-- Top Gauge & Summary Card -->
        <div style="background:linear-gradient(135deg, rgba(17, 24, 39, 0.8) 0%, rgba(15, 23, 42, 0.7) 100%); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:24px; display:grid; grid-template-columns:auto 1fr; gap:24px; align-items:center; box-shadow:0 8px 32px rgba(0,0,0,0.3); backdrop-filter:blur(16px);">
          <!-- Circular Gauge -->
          <div style="position:relative; width:120px; height:120px; display:flex; align-items:center; justify-content:center;">
            <svg width="120" height="120" viewBox="0 0 100 100" style="transform:rotate(-90deg);">
              <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8" />
              <circle cx="50" cy="50" r="46" fill="none" stroke="${scoreColor}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDashoffset}" style="transition:stroke-dashoffset 0.8s ease;" />
            </svg>
            <div style="position:absolute; text-align:center;">
              <div style="font-size:1.6rem; font-weight:800; font-family:var(--font-mono); color:var(--text-main); line-height:1;">
                ${score}%
              </div>
              <div style="font-size:0.65rem; font-weight:600; text-transform:uppercase; color:var(--text-dim); margin-top:2px;">
                Grade ${grade}
              </div>
            </div>
          </div>

          <!-- Summary Info -->
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge" style="background:${scoreColor}22; border-color:${scoreColor}; color:${scoreColor}; font-size:0.75rem; padding:4px 8px;">
                ${statusLabel}
              </span>
              <span style="font-size:0.78rem; color:var(--text-dim); font-family:var(--font-mono);">
                ${totalTracks} Berkas Terdaftar
              </span>
            </div>
            <h3 style="font-size:1.25rem; font-weight:700; color:var(--text-main); margin:8px 0 4px 0;">
              Status Kesehatan Koleksi Musik
            </h3>
            <p style="font-size:0.83rem; color:var(--text-muted); line-height:1.5; margin:0; max-width:680px;">
              Audiophile mendeteksi ketidaklengkapan metadata, sampul buram, berkas hilang, dan variasi ejaan artis. Semua perbaikan bersifat virtual (non-destruktif) dan dapat diurungkan kapan saja tanpa menyentuh berkas audio asli Anda di penyimpanan lokal.
            </p>
          </div>
        </div>

        <!-- 8 Category Issue Cards Grid -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:16px;">
          <!-- 1. Tag Kosong -->
          ${this.renderCard({
            id: 'emptyTags',
            title: 'Tag Kosong / Placeholder',
            count: categories.emptyTags.total,
            countLabel: 'lagu butuh tag',
            status: categories.emptyTags.total === 0 ? 'good' : 'warning',
            description: categories.emptyTags.total === 0
              ? 'Seluruh lagu memiliki judul, artis, album, dan informasi penting.'
              : `${categories.emptyTags.total} lagu kekurangan judul asli, nama artis, album, atau tahun rilis.`,
            actionBtnText: categories.emptyTags.total > 0 ? 'Periksa & Perbaiki' : 'Lihat Detail'
          })}

          <!-- 2. Cover Hilang / Rendah -->
          ${this.renderCard({
            id: 'covers',
            title: 'Sampul Hilang / Rendah (< 500px)',
            count: categories.covers.total,
            countLabel: 'lagu tanpa sampul prima',
            status: categories.covers.total === 0 ? 'good' : 'warning',
            description: categories.covers.total === 0
              ? 'Seluruh lagu memiliki sampul beresolusi tajam.'
              : `${categories.covers.missingCount} lagu tanpa sampul, ${categories.covers.lowResCount} lagu bersampul di bawah 500px.`,
            actionBtnText: categories.covers.total > 0 ? 'Wariskan / Perbaiki' : 'Lihat Detail'
          })}

          <!-- 3. Berkas Hilang -->
          ${this.renderCard({
            id: 'missingFiles',
            title: 'Berkas Hilang / Terputus',
            count: categories.missingFiles.total,
            countLabel: 'berkas tidak ditemukan',
            status: categories.missingFiles.total === 0 ? 'good' : 'danger',
            description: categories.missingFiles.total === 0
              ? 'Semua berkas audio terhubung dengan baik di folder lokal.'
              : `${categories.missingFiles.total} lagu berpindah tempat atau belum diberikan izin akses folder.`,
            actionBtnText: categories.missingFiles.total > 0 ? 'Wizard Relink' : 'Lihat Detail'
          })}

          <!-- 4. Berkas Rusak -->
          ${this.renderCard({
            id: 'corruptedFiles',
            title: 'Berkas Rusak / Gagal Baca',
            count: categories.corruptedFiles.total,
            countLabel: 'berkas bermasalah',
            status: categories.corruptedFiles.total === 0 ? 'good' : 'danger',
            description: categories.corruptedFiles.total === 0
              ? 'Seluruh berkas audio dapat diurai pemutar tanpa galat.'
              : `${categories.corruptedFiles.total} berkas rusak, terpotong, atau menggunakan codec tidak didukung.`,
            actionBtnText: categories.corruptedFiles.total > 0 ? 'Penjelasan & Diagnostik' : 'Lihat Detail'
          })}

          <!-- 5. Duplikat & Multi-Versi -->
          ${this.renderCard({
            id: 'duplicates',
            title: 'Duplikat & Multi-Versi',
            count: categories.duplicates.totalGroups,
            countLabel: 'grup lagu serupa',
            status: categories.duplicates.totalGroups === 0 ? 'good' : 'neutral',
            description: categories.duplicates.totalGroups === 0
              ? 'Tidak ada lagu duplikat dengan artis dan judul yang sama.'
              : `Ditemukan ${categories.duplicates.totalGroups} lagu yang memiliki lebih dari satu versi (mis. Lossless vs MP3).`,
            actionBtnText: categories.duplicates.totalGroups > 0 ? 'Bandingkan Versi (A/B)' : 'Lihat Detail'
          })}

          <!-- 6. Inkonsistensi Nama Artis/Album -->
          ${this.renderCard({
            id: 'inconsistent',
            title: 'Inkonsistensi Nama Artis & Album',
            count: categories.inconsistentArtists.total + categories.inconsistentAlbums.total,
            countLabel: 'variasi ejaan',
            status: (categories.inconsistentArtists.total + categories.inconsistentAlbums.total) === 0 ? 'good' : 'warning',
            description: (categories.inconsistentArtists.total + categories.inconsistentAlbums.total) === 0
              ? 'Ejaan artis dan album seragam (tidak ada selisih aksen/huruf besar).'
              : `Ditemukan variasi seperti tanda aksen atau huruf kapital (mis. "Beyonce" vs "Beyoncé").`,
            actionBtnText: (categories.inconsistentArtists.total + categories.inconsistentAlbums.total) > 0 ? 'Seragamkan Massal' : 'Lihat Detail'
          })}

          <!-- 7. Album Tersebar di Beberapa Folder -->
          ${this.renderCard({
            id: 'scattered',
            title: 'Album Tersebar di Beberapa Folder',
            count: categories.scatteredAlbums.total,
            countLabel: 'album terpisah folder',
            status: categories.scatteredAlbums.total === 0 ? 'good' : 'warning',
            description: categories.scatteredAlbums.total === 0
              ? 'Tiap album terkumpul rapi di dalam satu folder direktori.'
              : `${categories.scatteredAlbums.total} album memiliki trek yang terpencar di beberapa folder berbeda.`,
            actionBtnText: categories.scatteredAlbums.total > 0 ? 'Periksa Album' : 'Lihat Detail'
          })}

          <!-- 8. Kandidat Upgrade Lossy -->
          ${this.renderCard({
            id: 'upgrade',
            title: 'Kandidat Upgrade Lossy',
            count: categories.lossyUpgradeCandidates.total,
            countLabel: 'lagu lossy tanpa lossless',
            status: categories.lossyUpgradeCandidates.total === 0 ? 'good' : 'neutral',
            description: categories.lossyUpgradeCandidates.total === 0
              ? 'Seluruh lagu di koleksi Anda sudah bertaraf Lossless atau Hi-Res.'
              : `${categories.lossyUpgradeCandidates.total} lagu MP3/AAC yang belum memiliki salinan Lossless/FLAC di library.`,
            actionBtnText: 'Lihat Daftar Kandidat'
          })}
        </div>

        <!-- Issue Inspector Drawer (Dynamic Expandable Panel) -->
        <div id="healthDrawerContainer" style="${this.activeDrawer ? 'display:block;' : 'display:none;'}">
          ${this.renderActiveDrawer()}
        </div>
      </div>
    `;

    this.wireEvents();
  }

  renderCard({ id, title, count, countLabel, status, description, actionBtnText }) {
    let statusBadge = '';
    if (status === 'good') {
      statusBadge = '<span class="badge" style="background:rgba(34,197,94,0.15); border:1px solid var(--status-verified); color:#86efac; font-weight:700;">Beres</span>';
    } else if (status === 'danger') {
      statusBadge = `<span class="badge" style="background:rgba(239,68,68,0.18); border:1px solid rgba(239,68,68,0.45); color:#fca5a5; font-weight:700;">${count} Masalah</span>`;
    } else if (status === 'warning') {
      statusBadge = `<span class="badge" style="background:rgba(245,158,11,0.18); border:1px solid rgba(245,158,11,0.45); color:#fde68a; font-weight:700;">${count} Ditemukan</span>`;
    } else {
      statusBadge = `<span class="badge" style="background:rgba(59,130,246,0.15); border:1px solid var(--accent); color:#93c5fd; font-weight:700;">${count} Item</span>`;
    }

    const isCurrentActive = this.activeDrawer === id;

    return `
      <div class="glass-panel" style="padding:18px; border-radius:var(--radius-md); display:flex; flex-direction:column; justify-content:space-between; gap:12px; border:${isCurrentActive ? '1px solid var(--accent)' : '1px solid var(--border-subtle)'}; background:${isCurrentActive ? 'rgba(30, 58, 138, 0.15)' : 'var(--bg-surface)'};">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <h4 style="font-size:0.95rem; font-weight:700; color:var(--text-main); margin:0;">
              ${escapeHtml(title)}
            </h4>
            ${statusBadge}
          </div>
          <p style="font-size:0.8rem; color:var(--text-muted); line-height:1.45; margin:8px 0 0 0;">
            ${escapeHtml(description)}
          </p>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.06); padding-top:10px; margin-top:4px;">
          <span style="font-size:0.75rem; color:var(--text-dim); font-family:var(--font-mono);">
            ${count} ${escapeHtml(countLabel)}
          </span>
          <button class="btn btn-sm ${status === 'good' ? 'btn-ghost' : 'btn-secondary'} btnHealthToggleDrawer" data-drawer="${id}">
            <span>${isCurrentActive ? 'Tutup' : escapeHtml(actionBtnText)}</span>
          </button>
        </div>
      </div>
    `;
  }

  renderActiveDrawer() {
    if (!this.activeDrawer || !this.auditData) return '';

    const cat = this.auditData.categories;

    let contentHtml = '';
    let titleHtml = '';

    switch (this.activeDrawer) {
      case 'emptyTags': {
        titleHtml = 'Daftar Lagu dengan Tag Kosong atau Placeholder';
        const items = cat.emptyTags.items;
        if (items.length === 0) {
          contentHtml = '<p style="color:var(--text-muted); font-size:0.85rem;">Semua lagu sudah memiliki tag lengkap!</p>';
        } else {
          contentHtml = `
            <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
              <span style="font-size:0.8rem; color:var(--text-muted);">
                Klik "Edit" untuk mengubah tag lagu individual secara virtual.
              </span>
              <button class="btn btn-sm btn-primary" id="btnAutoGuessTags">
                Tebak Tag dari Nama Berkas (Pratinjau)
              </button>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px; max-height:360px; overflow-y:auto; padding-right:4px;">
              ${items.slice(0, 100).map(({ track, emptyFields }) => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(0,0,0,0.25); border-radius:var(--radius-sm); border:1px solid var(--border-subtle); gap:12px;">
                  <div style="min-width:0;">
                    <div style="font-size:0.85rem; font-weight:600; color:var(--text-main);" class="truncate">
                      ${escapeHtml(track.name)}
                    </div>
                    <div style="font-size:0.72rem; color:var(--status-suspect); font-family:var(--font-mono); margin-top:2px;">
                      Kosong: ${emptyFields.join(', ')}
                    </div>
                  </div>
                  <button class="btn btn-sm btn-secondary btnHealthEditTrack" data-track-id="${escapeHtml(track.id)}">
                    Edit
                  </button>
                </div>
              `).join('')}
            </div>
          `;
        }
        break;
      }

      case 'covers': {
        titleHtml = 'Sampul Album Hilang / Resolusi Rendah';
        const items = cat.covers.items;
        contentHtml = `
          <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <span style="font-size:0.8rem; color:var(--text-muted);">
              Wariskan sampul dari lagu lain dalam album yang sama secara virtual.
            </span>
            <button class="btn btn-sm btn-primary" id="btnInheritAlbumCovers">
              Wariskan Sampul Se-Album (Pratinjau)
            </button>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; max-height:360px; overflow-y:auto; padding-right:4px;">
            ${items.slice(0, 100).map(({ track, reason, width, height }) => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(0,0,0,0.25); border-radius:var(--radius-sm); border:1px solid var(--border-subtle); gap:12px;">
                <div style="min-width:0;">
                  <div style="font-size:0.85rem; font-weight:600; color:var(--text-main);" class="truncate">
                    ${escapeHtml(track.overrides?.title || track.metadata?.title || track.name)}
                  </div>
                  <div style="font-size:0.72rem; color:var(--text-dim);" class="truncate">
                    ${escapeHtml(track.overrides?.album || track.metadata?.album || 'Tanpa Album')} • ${escapeHtml(track.overrides?.artist || track.metadata?.artist || 'Artis Tidak Diketahui')}
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="badge ${reason === 'missing' ? 'badge-lossy' : 'badge-lossy-hq'}">
                    ${reason === 'missing' ? 'Sampul Hilang' : `${width}x${height}px (<500px)`}
                  </span>
                  <button class="btn btn-sm btn-secondary btnHealthEditTrack" data-track-id="${escapeHtml(track.id)}">
                    Ganti Sampul
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        `;
        break;
      }

      case 'missingFiles': {
        titleHtml = 'Berkas Hilang / Terputus';
        const items = cat.missingFiles.items;
        contentHtml = `
          <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <p style="font-size:0.82rem; color:var(--text-muted); margin:0;">
              Lagu-lagu di bawah tidak dapat diakses di komputer Anda. Gunakan Wizard Relink untuk mencocokkan kembali lewat sidik jari dan nama berkas.
            </p>
            <button class="btn btn-sm btn-primary" id="btnOpenRelinkWizard">
              Buka Wizard Relink
            </button>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; max-height:360px; overflow-y:auto; padding-right:4px;">
            ${items.map(({ track }) => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(0,0,0,0.25); border-radius:var(--radius-sm); border:1px solid rgba(239,68,68,0.25); gap:12px;">
                <div style="min-width:0;">
                  <div style="font-size:0.85rem; font-weight:600; color:var(--status-danger);" class="truncate">
                    ${escapeHtml(track.name)}
                  </div>
                  <div style="font-size:0.72rem; color:var(--text-dim);" class="truncate">
                    Lokasi sebelumnya: ${escapeHtml(track.relativePath || track.name)} (${formatFileSize(track.size)})
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="badge badge-missing">Hilang</span>
                  <button class="btn btn-sm btn-ghost btnHealthRemoveTrack" data-track-id="${escapeHtml(track.id)}" title="Hapus dari Koleksi" style="color:var(--status-danger);">
                    Hapus
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        `;
        break;
      }

      case 'corruptedFiles': {
        titleHtml = 'Berkas Rusak / Gagal Baca';
        const items = cat.corruptedFiles.items;
        contentHtml = `
          <div style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:var(--radius-sm); padding:12px; margin-bottom:12px; font-size:0.82rem; color:var(--text-main); line-height:1.5;">
            <strong>Penjelasan Awam:</strong> Pemutar peramban tidak dapat membaca header atau data audio dari berkas ini. Kemungkinan berkas terpotong saat diunduh, kontainer audio rusak, atau menggunakan format kompresi yang tidak didukung browser (seperti APE atau WAV IEEE Float tidak standar).<br>
            <em>Solusi:</em> Coba unduh ulang berkas dari sumber asli atau konversi ke format FLAC/WAV standar.
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; max-height:320px; overflow-y:auto; padding-right:4px;">
            ${items.map(({ track, reason }) => `
              <div style="padding:8px 12px; background:rgba(0,0,0,0.25); border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                <div style="font-size:0.85rem; font-weight:600; color:var(--text-main);" class="truncate">
                  ${escapeHtml(track.name)}
                </div>
                <div style="font-size:0.75rem; color:var(--status-danger); margin-top:2px;">
                  Penyebab: ${escapeHtml(reason)}
                </div>
              </div>
            `).join('')}
          </div>
        `;
        break;
      }

      case 'duplicates': {
        titleHtml = 'Grup Lagu Duplikat & Multi-Versi';
        const groups = cat.duplicates.groups;
        contentHtml = `
          <div style="margin-bottom:12px; font-size:0.82rem; color:var(--text-muted);">
            Lagu yang memiliki beberapa versi dapat dibandingkan langsung dengan alat A/B micro-fade untuk menguji perbedaan suara.
          </div>
          <div style="display:flex; flex-direction:column; gap:12px; max-height:360px; overflow-y:auto; padding-right:4px;">
            ${groups.map(({ key, tracks }) => `
              <div style="padding:12px; background:rgba(0,0,0,0.25); border-radius:var(--radius-sm); border:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <div style="min-width:0;">
                  <div style="font-size:0.88rem; font-weight:700; color:var(--text-main);" class="truncate">
                    ${escapeHtml(tracks[0].overrides?.title || tracks[0].metadata?.title || tracks[0].name)}
                  </div>
                  <div style="font-size:0.75rem; color:var(--text-dim);" class="truncate">
                    ${escapeHtml(tracks[0].overrides?.artist || tracks[0].metadata?.artist || 'Unknown Artist')} • ${tracks.length} versi
                  </div>
                  <div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">
                    ${tracks.map(t => {
                      const tier = t.tier || 'LOSSLESS';
                      const format = t.format || 'AUDIO';
                      return `
                        <span class="badge badge-${tier.toLowerCase().replace(/[^a-z]/g, '-')}">
                          ${escapeHtml(tier)} (${escapeHtml(format.toUpperCase())})
                        </span>
                      `;
                    }).join('')}
                  </div>
                </div>
                <button class="btn btn-sm btn-primary btnHealthLaunchAb" data-track-id="${escapeHtml(tracks[0].id)}">
                  Bandingkan (A/B)
                </button>
              </div>
            `).join('')}
          </div>
        `;
        break;
      }

      case 'inconsistent': {
        titleHtml = 'Inkonsistensi Nama Artis & Album';
        const artistItems = cat.inconsistentArtists.items;
        const albumItems = cat.inconsistentAlbums.items;
        const allItems = [...artistItems, ...albumItems];

        contentHtml = `
          <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <p style="font-size:0.82rem; color:var(--text-muted); margin:0;">
              Penyeragaman virtual akan menyamakan variasi ejaan (mis. "Beyonce" menjadi "Beyoncé") tanpa mengubah berkas asli di komputer.
            </p>
            <button class="btn btn-sm btn-primary" id="btnHarmonizeAllNames">
              Seragamkan Semua (Pratinjau)
            </button>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px; max-height:360px; overflow-y:auto; padding-right:4px;">
            ${allItems.map((item, idx) => `
              <div style="padding:12px; background:rgba(0,0,0,0.25); border-radius:var(--radius-sm); border:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <div style="min-width:0;">
                  <div style="font-size:0.72rem; color:var(--accent-light); font-weight:700; text-transform:uppercase;">
                    ${item.type === 'artist' ? 'Nama Artis' : `Album (${escapeHtml(item.artist)})`}
                  </div>
                  <div style="font-size:0.85rem; color:var(--text-main); margin-top:4px;">
                    Variasi: ${item.variants.map(v => `<strong>${escapeHtml(v.name)}</strong> (${v.count} lagu)`).join(' vs ')}
                  </div>
                  <div style="font-size:0.75rem; color:var(--status-verified); margin-top:2px;">
                    Saran Penyeragaman: <strong>${escapeHtml(item.recommended)}</strong>
                  </div>
                </div>
                <button class="btn btn-sm btn-secondary btnHarmonizeSingle" data-idx="${idx}">
                  Seragamkan Ini
                </button>
              </div>
            `).join('')}
          </div>
        `;
        break;
      }

      case 'scattered': {
        titleHtml = 'Album Tersebar di Beberapa Folder Direktori';
        const items = cat.scatteredAlbums.items;
        contentHtml = `
          <div style="margin-bottom:12px; font-size:0.82rem; color:var(--text-muted);">
            Lagu-lagu di bawah adalah bagian dari album yang sama tetapi tersimpan di folder berbeda. Anda dapat memastikan tag album dan artis seragam secara virtual.
          </div>
          <div style="display:flex; flex-direction:column; gap:10px; max-height:360px; overflow-y:auto; padding-right:4px;">
            ${items.map(item => `
              <div style="padding:12px; background:rgba(0,0,0,0.25); border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                <div style="font-size:0.88rem; font-weight:700; color:var(--text-main);">
                  ${escapeHtml(item.album)} - ${escapeHtml(item.artist)}
                </div>
                <div style="font-size:0.75rem; color:var(--text-dim); margin-top:4px;">
                  Tersebar di ${item.directories.length} folder:
                  <ul style="margin:4px 0 0 16px; padding:0; font-family:var(--font-mono); font-size:0.72rem;">
                    ${item.directories.map(d => `<li>${escapeHtml(d)}</li>`).join('')}
                  </ul>
                </div>
              </div>
            `).join('')}
          </div>
        `;
        break;
      }

      case 'upgrade': {
        titleHtml = 'Kandidat Upgrade Lossy';
        const items = cat.lossyUpgradeCandidates.items;
        contentHtml = `
          <div style="margin-bottom:12px; font-size:0.82rem; color:var(--text-muted);">
            Lagu lossy (MP3, AAC, Opus) berikut belum memiliki salinan FLAC di koleksi Anda. Anda dapat mengonversi langsung ke FLAC tanpa merusak metadata, atau menggantikannya dengan berkas lossless lokal.
          </div>

          <!-- Conversion Mode & Batch Actions Toolbar -->
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:14px; padding:12px 14px; background:rgba(0,0,0,0.3); border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
            <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
              <span style="font-size:0.8rem; font-weight:600; color:var(--text-main);">Opsi Konversi:</span>
              <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.78rem; cursor:pointer; color:var(--text-main);">
                <input type="radio" name="flacConvertMode" value="replace" checked />
                <span>Gantikan File Asli</span>
              </label>
              <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.78rem; cursor:pointer; color:var(--text-muted);">
                <input type="radio" name="flacConvertMode" value="duplicate" />
                <span>Duplikasi Versi Baru (A/B)</span>
              </label>
            </div>
            ${items.length > 0 ? `
              <button class="btn btn-primary btn-sm" id="btnBatchConvertFlac" style="font-size:0.78rem;">
                Konversi Semua ke FLAC (${items.length})
              </button>
            ` : ''}
          </div>

          <div style="display:flex; flex-direction:column; gap:8px; max-height:360px; overflow-y:auto; padding-right:4px;">
            ${items.length === 0 ? `
              <div style="padding:24px; text-align:center; color:var(--text-dim); font-size:0.85rem;">
                Semua lagu di koleksi Anda sudah memiliki format lossless atau belum ada kandidat upgrade.
              </div>
            ` : items.slice(0, 100).map(({ track, currentTier, format }) => `
              <div class="health-upgrade-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(0,0,0,0.25); border-radius:var(--radius-sm); border:1px solid var(--border-subtle); gap:12px; flex-wrap:wrap;">
                <div style="min-width:0; flex:1;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:0.88rem; font-weight:600; color:var(--text-main);" class="truncate">
                      ${escapeHtml(track.overrides?.title || track.metadata?.title || track.name)}
                    </span>
                    <span class="badge badge-lossy" style="font-size:0.68rem;">
                      ${escapeHtml(currentTier)} (${escapeHtml(format.toUpperCase())})
                    </span>
                  </div>
                  <div style="font-size:0.75rem; color:var(--text-dim); margin-top:3px;" class="truncate">
                    ${escapeHtml(track.overrides?.artist || track.metadata?.artist || 'Unknown Artist')} &bull; ${escapeHtml(track.overrides?.album || track.metadata?.album || 'Tanpa Album')}
                  </div>
                </div>

                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                  <button class="btn btn-sm btn-primary btnConvertSingleFlac" data-track-id="${escapeHtml(track.id)}" title="Konversi audio ke FLAC tanpa merusak metadata">
                    Konversi ke FLAC
                  </button>
                  <label class="btn btn-sm btn-secondary" style="cursor:pointer; margin:0;" title="Ganti dengan berkas lossless lokal">
                    Ganti Berkas Lossless
                    <input type="file" class="inputReplaceLosslessFile" data-track-id="${escapeHtml(track.id)}" accept=".flac,.wav,.aiff,.alac" style="display:none;" />
                  </label>
                  <button class="btn btn-sm btn-ghost btnHealthEditTrack" data-track-id="${escapeHtml(track.id)}" title="Sunting atau lengkapi metadata">
                    Edit Metadata
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        `;
        break;
      }
    }

    return `
      <div class="glass-panel" style="padding:20px; border-radius:var(--radius-lg); border:1px solid var(--accent); background:rgba(15, 23, 42, 0.85); box-shadow:0 8px 32px rgba(0,0,0,0.35);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:12px;">
          <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-main); margin:0;">
            ${titleHtml}
          </h3>
          <button class="btn btn-sm btn-ghost" id="btnCloseHealthDrawer">
            Tutup Panel
          </button>
        </div>
        ${contentHtml}
      </div>
    `;
  }

  wireEvents() {
    if (!this.container) return;

    // Rescan button
    this.container.querySelector('#btnHealthRescan')?.addEventListener('click', () => {
      this.isRescanning = true;
      this.runAuditAndRender();
    });

    // Undo buttons
    const handleUndo = async () => {
      const undone = await healthService.undoLastRepair();
      if (undone) {
        toast.success(`Berhasil mengurungkan: ${undone.description}`);
        this.runAuditAndRender();
      }
    };
    this.container.querySelector('#btnHealthUndo')?.addEventListener('click', handleUndo);
    this.container.querySelector('#btnBannerUndo')?.addEventListener('click', handleUndo);

    // Drawer toggle buttons
    this.container.querySelectorAll('.btnHealthToggleDrawer').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetDrawer = btn.getAttribute('data-drawer');
        if (this.activeDrawer === targetDrawer) {
          this.activeDrawer = null;
        } else {
          this.activeDrawer = targetDrawer;
        }
        this.render();
        const drawerEl = document.getElementById('healthDrawerContainer');
        if (drawerEl && this.activeDrawer) {
          drawerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });

    // Close drawer button
    this.container.querySelector('#btnCloseHealthDrawer')?.addEventListener('click', () => {
      this.activeDrawer = null;
      this.render();
    });

    // Edit track individual
    this.container.querySelectorAll('.btnHealthEditTrack').forEach(btn => {
      btn.addEventListener('click', () => {
        const trackId = btn.getAttribute('data-track-id');
        const tracks = store.get('tracks') || [];
        const track = tracks.find(t => t.id === trackId);
        if (track) {
          metadataEditor.open(track);
        }
      });
    });

    // Launch A/B comparison for duplicates
    this.container.querySelectorAll('.btnHealthLaunchAb').forEach(btn => {
      btn.addEventListener('click', () => {
        const trackId = btn.getAttribute('data-track-id');
        const tracks = store.get('tracks') || [];
        const track = tracks.find(t => t.id === trackId);
        if (track) {
          abCompareModal.open(track);
        }
      });
    });

    // Relink Wizard
    this.container.querySelector('#btnOpenRelinkWizard')?.addEventListener('click', () => {
      this.openRelinkModal();
    });

    // Remove individual missing track
    this.container.querySelectorAll('.btnHealthRemoveTrack').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const trackId = btn.getAttribute('data-track-id');
        const tracks = store.get('tracks') || [];
        const track = tracks.find(t => t.id === trackId);
        if (!track) return;
        const confirmed = await dialog.confirm(
          'Hapus dari Koleksi',
          `Hapus "${track.name}" dari koleksi Anda? Berkas fisik di komputer Anda tidak akan terhapus.`,
          'Hapus',
          'Batal'
        );
        if (confirmed) {
          const updated = tracks.filter(t => t.id !== trackId);
          store.set('tracks', updated);
          try {
            await db.delete('tracks', trackId);
          } catch {}
          toast.info(`"${track.name}" telah dihapus dari koleksi.`);
          this.runAuditAndRender();
        }
      });
    });

    // Inherit Album Covers Batch
    this.container.querySelector('#btnInheritAlbumCovers')?.addEventListener('click', () => {
      this.prepareAlbumCoverInheritancePreview();
    });

    // Auto-guess tags from filename
    this.container.querySelector('#btnAutoGuessTags')?.addEventListener('click', () => {
      this.prepareAutoGuessTagsPreview();
    });

    // Harmonize all names
    this.container.querySelector('#btnHarmonizeAllNames')?.addEventListener('click', () => {
      this.prepareHarmonizeAllPreview();
    });

    // Harmonize single inconsistency
    this.container.querySelectorAll('.btnHarmonizeSingle').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        this.prepareHarmonizeSinglePreview(idx);
      });
    });

    // Convert single track to FLAC
    this.container.querySelectorAll('.btnConvertSingleFlac').forEach(btn => {
      btn.addEventListener('click', async () => {
        const trackId = btn.getAttribute('data-track-id');
        const tracks = store.get('tracks') || [];
        const track = tracks.find(t => t.id === trackId);
        if (!track) return;

        const defaultMode = document.querySelector('input[name="flacConvertMode"]:checked')?.value || 'replace';
        const chosen = await dialog.confirm(
          'Konversi ke FLAC',
          `Pilih tindakan untuk "${track.name}":\n\n- Gantikan Asli: Format lagu di pustaka diubah ke FLAC, mempertahankan riwayat & playlist.\n- Duplikasi Baru: Menambahkan berkas FLAC baru berdampingan untuk perbandingan A/B.`,
          'Gantikan Asli',
          'Duplikasi Baru'
        );
        const mode = chosen ? 'replace' : 'duplicate';

        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerText = 'Mengonversi...';

        try {
          const result = await flacConverter.convertTrackToFlac(track, {
            mode,
            onProgress: (pct) => {
              btn.innerText = `${Math.round(pct * 100)}%`;
            }
          });
          toast.success(`Berhasil mengonversi "${result.filename}" (${mode === 'replace' ? 'Gantikan Asli' : 'Duplikasi'})`);
          this.runAuditAndRender();
        } catch (err) {
          console.error('Konversi gagal:', err);
          toast.error(`Konversi gagal: ${err.message || 'Kesalahan Web Audio'}`);
        } finally {
          btn.disabled = false;
          btn.innerText = originalText;
        }
      });
    });

    // Replace lossy track with local lossless file
    this.container.querySelectorAll('.inputReplaceLosslessFile').forEach(input => {
      input.addEventListener('change', async (e) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        const trackId = input.getAttribute('data-track-id');
        const tracks = store.get('tracks') || [];
        const track = tracks.find(t => t.id === trackId);
        if (!track) return;

        const ext = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
        try {
          let parsed = { streamInfo: {}, metadata: {} };
          if (ext === 'flac') parsed = await MetadataParser.parseFLAC(file);
          else if (ext === 'wav') parsed = await MetadataParser.parseWAV(file);
          else if (['m4a', 'alac'].includes(ext)) parsed = await MetadataParser.parseMP4(file);
          else parsed = await MetadataParser.parseFLAC(file);

          const tierInfo = classifyQualityTier(parsed.streamInfo, ext);
          const updatedTrack = {
            ...track,
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
            format: ext,
            streamInfo: Object.keys(parsed.streamInfo).length > 0 ? parsed.streamInfo : track.streamInfo,
            tier: tierInfo.tier,
            tierDetails: tierInfo.details,
            metadata: {
              ...track.metadata,
              ...(parsed.metadata.title ? { title: parsed.metadata.title } : {}),
              ...(parsed.metadata.artist ? { artist: parsed.metadata.artist } : {}),
              ...(parsed.metadata.album ? { album: parsed.metadata.album } : {})
            }
          };

          folderManager.registerInMemoryFile(track.id, file);
          await db.put('tracks', updatedTrack);
          const updatedList = tracks.map(t => (t.id === track.id ? updatedTrack : t));
          store.set('tracks', updatedList);

          toast.success(`"${track.name}" berhasil digantikan dengan "${file.name}" (${tierInfo.tier}).`);
          this.runAuditAndRender();
        } catch (err) {
          console.error('Penggantian berkas gagal:', err);
          toast.error(`Gagal memproses berkas pengganti: ${err.message}`);
        }
      });
    });

    // Batch convert all lossy candidates to FLAC
    this.container.querySelector('#btnBatchConvertFlac')?.addEventListener('click', async () => {
      const mode = document.querySelector('input[name="flacConvertMode"]:checked')?.value || 'replace';
      const cat = this.cachedAudit?.categories;
      const items = cat?.lossyUpgradeCandidates?.items || [];
      if (items.length === 0) {
        toast.info('Tidak ada lagu lossy yang perlu dikonversi.');
        return;
      }

      const confirmed = await dialog.confirm(
        'Konversi Semua ke FLAC',
        `Mulai konversi ${items.length} lagu lossy ke format FLAC (Mode: ${mode === 'replace' ? 'Gantikan Asli' : 'Duplikasi'})?`,
        'Mulai Konversi',
        'Batal'
      );
      if (!confirmed) return;

      const batchBtn = document.getElementById('btnBatchConvertFlac');
      if (batchBtn) {
        batchBtn.disabled = true;
        batchBtn.innerText = 'Mengonversi (0%)...';
      }

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (batchBtn) {
          batchBtn.innerText = `Mengonversi ${i + 1}/${items.length}...`;
        }
        try {
          await flacConverter.convertTrackToFlac(item.track, { mode });
          successCount++;
        } catch (err) {
          console.warn(`Gagal mengonversi ${item.track.name}:`, err);
          failCount++;
        }
      }

      if (batchBtn) {
        batchBtn.disabled = false;
        batchBtn.innerText = `Konversi Semua ke FLAC (${items.length})`;
      }

      toast.success(`Konversi massal selesai: ${successCount} berhasil${failCount > 0 ? `, ${failCount} dilewati` : ''}.`);
      this.runAuditAndRender();
    });
  }

  // PREVIEW & NON-DESTRUCTIVE REPAIR DIALOGS

  /**
   * Show interactive Preview Modal with diff table before applying virtual overrides
   * @param {Object} options
   */
  openPreviewModal({ title, description, diffs, onConfirm }) {
    this.closePreviewModal();

    const overlay = document.createElement('div');
    overlay.className = 'metadata-editor-overlay';
    overlay.id = 'healthPreviewOverlay';

    overlay.innerHTML = `
      <div class="metadata-editor-card" style="max-width:720px;" role="dialog" aria-modal="true" aria-labelledby="healthPrevTitle">
        <div class="metadata-editor-header">
          <div>
            <h3 class="metadata-editor-title" id="healthPrevTitle">${escapeHtml(title)}</h3>
            <p class="metadata-editor-sub">${escapeHtml(description)}</p>
          </div>
          <button class="btn btn-icon metadata-editor-close" id="btnPrevClose" aria-label="Tutup">${getIconSvg('close', { size: 18 })}</button>
        </div>

        <div style="background:rgba(30, 58, 138, 0.15); border:1px solid rgba(59, 130, 246, 0.3); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:14px; font-size:0.78rem; color:var(--text-main); line-height:1.45;">
          <strong>Perlindungan Non-Destruktif:</strong> Berkas musik asli di disk komputer Anda TIDAK diubah. Perubahan ini hanya disimpan sebagai override virtual di aplikasi. Anda dapat mengurungkan perubahan kapan saja dengan 1 klik tombol "Urungkan".
        </div>

        <div style="max-height:360px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); margin-bottom:16px;">
          <table style="width:100%; border-collapse:collapse; font-size:0.8rem; text-align:left;">
            <thead>
              <tr style="background:rgba(255,255,255,0.05); border-bottom:1px solid var(--border-subtle);">
                <th style="padding:8px 12px; font-weight:600; color:var(--text-dim);">Berkas / Lagu</th>
                <th style="padding:8px 12px; font-weight:600; color:var(--text-dim);">Nilai Saat Ini</th>
                <th style="padding:8px 12px; font-weight:600; color:var(--accent-light);">Nilai Baru (Override)</th>
              </tr>
            </thead>
            <tbody>
              ${diffs.map(d => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                  <td style="padding:8px 12px; color:var(--text-main); font-weight:500;">
                    ${escapeHtml(d.name)}
                  </td>
                  <td style="padding:8px 12px; color:var(--status-suspect);">
                    ${escapeHtml(d.current)}
                  </td>
                  <td style="padding:8px 12px; color:var(--status-verified); font-weight:600;">
                    ${escapeHtml(d.proposed)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="metadata-editor-footer">
          <button type="button" class="btn btn-secondary" id="btnPrevCancel">Batal</button>
          <button type="button" class="btn btn-primary" id="btnPrevApply">
            Terapkan Perubahan Virtual (${diffs.length})
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.previewModalElement = overlay;

    const handleClose = () => this.closePreviewModal();
    overlay.querySelector('#btnPrevClose')?.addEventListener('click', handleClose);
    overlay.querySelector('#btnPrevCancel')?.addEventListener('click', handleClose);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) handleClose();
    });

    overlay.querySelector('#btnPrevApply')?.addEventListener('click', async () => {
      handleClose();
      await onConfirm();
    });
  }

  closePreviewModal() {
    if (this.previewModalElement) {
      this.previewModalElement.remove();
      this.previewModalElement = null;
    }
  }

  /**
   * Wizard Relink Modal for matching and restoring missing tracks
   */
  openRelinkModal() {
    this.closeRelinkModal();

    const missingTracks = (this.auditData?.categories.missingFiles.items || []).map(i => i.track);
    if (missingTracks.length === 0) {
      toast.info('Tidak ada berkas yang hilang dalam koleksi saat ini.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'metadata-editor-overlay';
    overlay.id = 'healthRelinkOverlay';

    overlay.innerHTML = `
      <div class="metadata-editor-card" style="max-width:700px;" role="dialog" aria-modal="true" aria-labelledby="relinkWizardTitle">
        <div class="metadata-editor-header">
          <div>
            <h3 class="metadata-editor-title" id="relinkWizardTitle">Wizard Relink Berkas Hilang</h3>
            <p class="metadata-editor-sub">${missingTracks.length} berkas perlu dicocokkan ulang</p>
          </div>
          <button class="btn btn-icon metadata-editor-close" id="btnRelinkClose" aria-label="Tutup">${getIconSvg('close', { size: 18 })}</button>
        </div>

        <div style="font-size:0.83rem; color:var(--text-muted); line-height:1.5; margin-bottom:14px;">
          Pilih berkas atau folder baru di komputer Anda. Audiophile akan memeriksa sidik jari dan nama berkas secara otomatis untuk memulihkan akses tanpa merusak riwayat putar dan playlist Anda.
        </div>

        <div style="background:rgba(255,255,255,0.03); border:2px dashed var(--border-medium); border-radius:var(--radius-md); padding:24px; text-align:center; margin-bottom:16px;">
          <input type="file" id="relinkFileInput" multiple style="display:none;" />
          <button type="button" class="btn btn-primary" id="btnRelinkSelectFiles">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span>Pilih Berkas Pengganti</span>
          </button>
          <div style="font-size:0.75rem; color:var(--text-dim); margin-top:8px;">
            Pilih satu atau beberapa berkas yang telah berpindah folder
          </div>
        </div>

        <div id="relinkMatchResults" style="display:none; max-height:280px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); margin-bottom:16px; padding:10px;"></div>

        <div class="metadata-editor-footer">
          <button type="button" class="btn btn-secondary" id="btnRelinkCancel">Tutup</button>
          <button type="button" class="btn btn-primary" id="btnRelinkApply" style="display:none;">
            Tautkan Ulang Berkas Terpilih
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.relinkModalElement = overlay;

    let candidateMatches = [];

    const handleClose = () => this.closeRelinkModal();
    overlay.querySelector('#btnRelinkClose')?.addEventListener('click', handleClose);
    overlay.querySelector('#btnRelinkCancel')?.addEventListener('click', handleClose);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) handleClose();
    });

    const fileInput = overlay.querySelector('#relinkFileInput');
    overlay.querySelector('#btnRelinkSelectFiles')?.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput?.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      if (files.length === 0) return;

      candidateMatches = healthService.findRelinkMatches(missingTracks, files);
      const resultsContainer = overlay.querySelector('#relinkMatchResults');
      const applyBtn = overlay.querySelector('#btnRelinkApply');

      if (candidateMatches.length === 0) {
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = `
          <div style="text-align:center; padding:16px; color:var(--status-suspect); font-size:0.85rem;">
            Tidak ditemukan kecocokan antara berkas yang Anda pilih dengan ${missingTracks.length} berkas yang hilang.
          </div>
        `;
        applyBtn.style.display = 'none';
      } else {
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = `
          <div style="font-size:0.8rem; font-weight:700; color:var(--status-verified); margin-bottom:8px;">
            Ditemukan ${candidateMatches.length} kecocokan:
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${candidateMatches.map(m => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:rgba(0,0,0,0.3); border-radius:var(--radius-sm); font-size:0.78rem;">
                <div>
                  <div style="font-weight:600; color:var(--text-main);">${escapeHtml(m.missingTrack.name)}</div>
                  <div style="color:var(--text-dim); font-size:0.72rem;">Dicocokkan dengan: ${escapeHtml(m.matchedFile.name)}</div>
                </div>
                <span class="badge ${m.score >= 0.95 ? 'badge-verified' : 'badge-suspect'}">
                  ${Math.round(m.score * 100)}% (${escapeHtml(m.reason)})
                </span>
              </div>
            `).join('')}
          </div>
        `;
        applyBtn.style.display = 'inline-flex';
        applyBtn.innerText = `Tautkan Ulang ${candidateMatches.length} Berkas`;
      }
    });

    overlay.querySelector('#btnRelinkApply')?.addEventListener('click', async () => {
      if (candidateMatches.length === 0) return;
      const count = await healthService.applyRelinkMatches(candidateMatches);
      toast.success(`Berhasil menautkan ulang ${count} berkas musik!`);
      handleClose();
      this.runAuditAndRender();
    });
  }

  closeRelinkModal() {
    if (this.relinkModalElement) {
      this.relinkModalElement.remove();
      this.relinkModalElement = null;
    }
  }

  // BATCH REPAIR PREVIEW GENERATORS

  prepareAlbumCoverInheritancePreview() {
    const allTracks = store.get('tracks') || [];
    const repairs = [];
    const diffs = [];

    // Group albums that have at least one cover
    const albumCoverMap = new Map();
    for (const t of allTracks) {
      const alb = (t.overrides?.album || t.metadata?.album || '').toLowerCase().trim();
      const pic = t.overrides?.pictureUrl || t.metadata?.pictureUrl;
      if (alb && alb !== 'tanpa album' && alb !== 'album tidak diketahui' && pic) {
        if (!albumCoverMap.has(alb)) {
          albumCoverMap.set(alb, pic);
        }
      }
    }

    for (const t of allTracks) {
      const alb = (t.overrides?.album || t.metadata?.album || '').toLowerCase().trim();
      const currentPic = t.overrides?.pictureUrl || t.metadata?.pictureUrl;
      if (alb && !currentPic && albumCoverMap.has(alb)) {
        const proposedPic = albumCoverMap.get(alb);
        repairs.push({
          trackId: t.id,
          patch: { pictureUrl: proposedPic }
        });
        diffs.push({
          name: t.name,
          current: 'Tanpa Sampul',
          proposed: `Wariskan dari album "${t.overrides?.album || t.metadata?.album}"`
        });
      }
    }

    if (repairs.length === 0) {
      toast.info('Tidak ada sampul album yang dapat diwariskan antar trek.');
      return;
    }

    this.openPreviewModal({
      title: 'Pratinjau Pewarisan Sampul Se-Album',
      description: `Menyalin sampul album ke ${repairs.length} lagu dalam album yang sama yang belum memiliki gambar.`,
      diffs,
      onConfirm: async () => {
        await healthService.applyBulkOverrides(repairs, `Pewarisan sampul se-album (${repairs.length} lagu)`);
        toast.success(`Berhasil mewariskan sampul ke ${repairs.length} lagu.`);
        this.runAuditAndRender();
      }
    });
  }

  prepareAutoGuessTagsPreview() {
    const emptyItems = this.auditData?.categories.emptyTags.items || [];
    const repairs = [];
    const diffs = [];

    for (const { track, emptyFields } of emptyItems) {
      // Guess Title & Artist from format "Artist - Title.ext"
      const base = track.name.replace(/\.[^/.]+$/, '');
      const patch = {};
      let proposedDesc = [];

      if (base.includes(' - ')) {
        const parts = base.split(' - ');
        const guessedArtist = parts[0].trim();
        const guessedTitle = parts.slice(1).join(' - ').trim();

        if (emptyFields.includes('artist') && guessedArtist) {
          patch.artist = guessedArtist;
          proposedDesc.push(`Artis: ${guessedArtist}`);
        }
        if (emptyFields.includes('title') && guessedTitle) {
          patch.title = guessedTitle;
          proposedDesc.push(`Judul: ${guessedTitle}`);
        }
      } else {
        if (emptyFields.includes('title')) {
          patch.title = base;
          proposedDesc.push(`Judul: ${base}`);
        }
      }

      if (Object.keys(patch).length > 0) {
        repairs.push({
          trackId: track.id,
          patch
        });
        diffs.push({
          name: track.name,
          current: `Kosong (${emptyFields.join(', ')})`,
          proposed: proposedDesc.join(', ')
        });
      }
    }

    if (repairs.length === 0) {
      toast.info('Tidak ada nama berkas yang dapat ditebak polanya secara otomatis.');
      return;
    }

    this.openPreviewModal({
      title: 'Pratinjau Tebak Tag dari Nama Berkas',
      description: `Menerapkan tag judul dan artis virtual berdasarkan pola nama berkas untuk ${repairs.length} lagu.`,
      diffs,
      onConfirm: async () => {
        await healthService.applyBulkOverrides(repairs, `Tebak tag dari nama berkas (${repairs.length} lagu)`);
        toast.success(`Berhasil menerapkan tag virtual untuk ${repairs.length} lagu.`);
        this.runAuditAndRender();
      }
    });
  }

  prepareHarmonizeAllPreview() {
    const cat = this.auditData?.categories;
    if (!cat) return;

    const allItems = [...cat.inconsistentArtists.items, ...cat.inconsistentAlbums.items];
    const repairs = [];
    const diffs = [];

    for (const item of allItems) {
      const canonical = item.recommended;
      for (const variant of item.variants) {
        if (variant.name !== canonical) {
          for (const track of variant.tracks) {
            const patch = item.type === 'artist' ? { artist: canonical } : { album: canonical };
            repairs.push({ trackId: track.id, patch });
            diffs.push({
              name: track.overrides?.title || track.metadata?.title || track.name,
              current: `${item.type === 'artist' ? 'Artis' : 'Album'}: "${variant.name}"`,
              proposed: `"${canonical}"`
            });
          }
        }
      }
    }

    if (repairs.length === 0) {
      toast.info('Tidak ada inkonsistensi yang perlu diseragamkan.');
      return;
    }

    this.openPreviewModal({
      title: 'Pratinjau Penyeragaman Seluruh Nama Artis & Album',
      description: `Menyeragamkan ${repairs.length} lagu ke ejaan kanonikal yang direkomendasikan secara virtual.`,
      diffs,
      onConfirm: async () => {
        await healthService.applyBulkOverrides(repairs, `Penyeragaman ejaan nama massal (${repairs.length} lagu)`);
        toast.success(`Berhasil menyeragamkan ejaan untuk ${repairs.length} lagu.`);
        this.runAuditAndRender();
      }
    });
  }

  prepareHarmonizeSinglePreview(idx) {
    const cat = this.auditData?.categories;
    if (!cat) return;

    const allItems = [...cat.inconsistentArtists.items, ...cat.inconsistentAlbums.items];
    const item = allItems[idx];
    if (!item) return;

    const repairs = [];
    const diffs = [];
    const canonical = item.recommended;

    for (const variant of item.variants) {
      if (variant.name !== canonical) {
        for (const track of variant.tracks) {
          const patch = item.type === 'artist' ? { artist: canonical } : { album: canonical };
          repairs.push({ trackId: track.id, patch });
          diffs.push({
            name: track.overrides?.title || track.metadata?.title || track.name,
            current: `${item.type === 'artist' ? 'Artis' : 'Album'}: "${variant.name}"`,
            proposed: `"${canonical}"`
          });
        }
      }
    }

    this.openPreviewModal({
      title: `Pratinjau Penyeragaman ${item.type === 'artist' ? 'Artis' : 'Album'}`,
      description: `Menyeragamkan ke "${canonical}" untuk ${repairs.length} lagu.`,
      diffs,
      onConfirm: async () => {
        await healthService.applyBulkOverrides(repairs, `Penyeragaman ke "${canonical}" (${repairs.length} lagu)`);
        toast.success(`Berhasil menyeragamkan ke "${canonical}".`);
        this.runAuditAndRender();
      }
    });
  }
}

export const healthView = new HealthView();
