# HiFiLocal — Honest Audiophile Local Player & Hi-Res Verifier

HiFiLocal adalah aplikasi web pemutar musik lokal berstandar audiophile yang berjalan murni di sisi peramban (Vanilla JavaScript ES Modules, tanpa backend, tanpa akun, 100% lokal dan offline). Aplikasi ini mengusung prinsip transparansi kualitas audio: mendeteksi tier kualitas teknis file, memverifikasi keaslian sinyal frekuensi Hi-Res melalui analisis spektrum FFT di Web Worker (mendeteksi file upsampled atau transcode palsu), serta menyajikan signal path yang jujur kepada pengguna.

---

## Cara Menjalankan

### Cara Cepat & Ringan (Rekomendasi)
Jalankan perintah berikut di terminal:
```bash
npm run dev
```
atau:
```bash
node server.js
```
Aplikasi langsung aktif di `http://localhost:3000/`.
- **Nol dependensi eksternal**: Menggunakan HTTP server bawaan Node.js tanpa perlu `npm install`.
- **Mati seketika saat `Ctrl + C`**: Penanganan sinyal SIGINT/SIGTERM memastikan server langsung berhenti tanpa menggantung di Windows.
- **Port fallback otomatis**: Jika port 3000 sedang terpakai, server otomatis memilih port berikutnya (3001, 3002, dst).

### Menjalankan Unit Tests
Jalankan pengujian unit otomatis di terminal:
```bash
npm test
```
atau:
```bash
node tests/run-cli.js
```
Untuk visual test runner interaktif di peramban, buka:
`http://localhost:3000/tests/test.html`

### Menjalankan via Server Lain
```bash
# Menggunakan Python 3
python -m http.server 3000

# Atau ekstensi VS Code Live Server
Klik kanan index.html -> "Open with Live Server"
```

---

## PWA & Kemampuan Offline

HiFiLocal dirancang sebagai Progressive Web App (PWA) mandiri:
1. **Dapat Diinstal (Installable)**: Di Chrome, Edge, atau browser mobile, klik ikon instal di bilah alamat browser untuk memasang HiFiLocal sebagai aplikasi desktop/mobile independen.
2. **Offline-First App Shell**: Dilengkapi Service Worker (`sw.js`) dengan strategi caching stale-while-revalidate untuk seluruh aset app shell. Aplikasi dapat dibuka dan digunakan sepenuhnya tanpa koneksi internet.
3. **Penyimpanan Lokal Persisten**: Struktur direktori, metadata musik, statistik putar, bookmark antrean, dan override tag disimpan secara lokal di IndexedDB peramban pengguna.

---

## Struktur Proyek Modular

HiFiLocal dibangun menggunakan arsitektur Vanilla ES Modules murni tanpa bundler maupun transpiler:

```
hifilocal/
├── index.html                  # App shell HTML, semantik landmark, dan container modal
├── manifest.webmanifest        # PWA Web App Manifest
├── sw.js                       # Service Worker (offline app shell caching)
├── server.js                   # Server statis HTTP bawaan Node.js (tanpa dependensi)
├── README.md                   # Dokumentasi teknis dan panduan operasional
├── assets/
│   └── icons/
│       └── icon.svg            # Ikon vektor aplikasi beresolusi tinggi (maskable)
├── css/
│   ├── tokens.css              # Variabel desain Aurora Glass, palet warna, dan specular border
│   ├── motion.css              # Kurva fisika spring, transisi, dan durasi gerak
│   ├── base.css                # Reset CSS, variabel dasar, tipografi, dan fokus aksesibilitas
│   ├── layout.css              # Layout 3 lapis responsif (dock, center stage, drawer, player)
│   ├── components.css          # Komponen UI: tombol, badge tier, lirik, slider, toast, dialog
│   └── themes.css              # Tema warna (Dark Audiophile, OLED, Light, Contrast)
├── js/
│   ├── main.js                 # Entry point aplikasi, bootstrap, dan navigasi global
│   ├── core/
│   │   ├── events.js           # EventBus terdesentralisasi (pub/sub pattern)
│   │   ├── store.js            # Reactive Central Store dengan langganan state
│   │   ├── router.js           # Router navigasi antar tampilan
│   │   ├── utils.js            # Fungsi utilitas (hashing ID stabil, format durasi, sanitasi HTML)
│   │   ├── i18n.js             # Manajer multibahasa
│   │   └── perf.js             # Monitor performa FPS dan adaptasi visual perangkat
│   ├── i18n/
│   │   ├── id.js               # Terjemahan Bahasa Indonesia (bawaan)
│   │   └── en.js               # Terjemahan Bahasa Inggris
│   ├── db/
│   │   ├── schema.js           # Skema IndexedDB berversi dan logika migrasi
│   │   └── db.js               # Wrapper Promise IndexedDB untuk transaksi asinkron
│   ├── library/
│   │   ├── folders.js          # File System Access API & verifikasi izin direktori
│   │   ├── metadata.js         # Parser biner mandiri (FLAC STREAMINFO, WAV fmt, ID3v2, USLT, MP4)
│   │   ├── scanner.js          # Pemindai inkremental dan pencocokan relink berkas
│   │   ├── dedupe.js           # Deteksi duplikat cerdas dan seleksi versi kualitas terbaik
│   │   └── search.js           # Mesin pencari multi-token dan penyortir multi-kriteria
│   ├── quality/
│   │   ├── tiers.js            # Klasifikasi tier kualitas audio dan penandaan badge
│   │   └── analyzer.js         # Pengontrol Web Worker analisis spektrum frekuensi
│   ├── workers/
│   │   └── analyze.worker.js   # Web Worker FFT spectrum analyzer dan detektor cutoff frekuensi
│   ├── player/
│   │   ├── engine.js           # Mesin pemutar audio dual-element (gapless dan DSP)
│   │   ├── queue.js            # Manajer antrean lagu, sisip berikutnya, acak, dan urutkan
│   │   ├── mediaSession.js     # Integrasi Media Session API (lockscreen, cover, kontrol media)
│   │   └── sleepTimer.js       # Pengatur timer henti pemutaran otomatis
│   ├── playlists/
│   │   ├── playlistService.js  # CRUD playlist lokal dengan proteksi duplikasi
│   │   ├── smartRules.js       # Evaluator Smart Playlist dinamis berbasis aturan logika AND/OR
│   │   └── m3u.js              # Ekspor dan impor berkas playlist standar M3U/M3U8
│   ├── backup/
│   │   └── exportImport.js     # Pencadangan dan pemulihan data aplikasi ke/dari berkas JSON
│   └── ui/
│       ├── ambient.js          # Ekstraktor palet warna cover art dinamis dengan cross-fade 900ms
│       ├── lyrics.js           # Parser LRC canggih (standar, offset, word-by-word) & spring scroller
│       ├── motion/
│       │   ├── spring.js       # Mesin fisika pegas (stiffness, damping, mass)
│       │   ├── flip.js         # Animasi FLIP untuk reorder antrean dan daftar
│       │   ├── viewTransition.js# Adapter View Transitions API
│       │   └── gestures.js     # Pengenal gestur sentuh (drag, dismiss sheet, thresholding)
│       ├── components/
│       │   ├── toast.js        # Notifikasi toast dengan opsi aksi Urungkan (Undo)
│       │   ├── dialog.js       # Dialog konfirmasi dan input modal yang accessible
│       │   ├── contextMenu.js  # Menu konteks klik-kanan dan tekan-lama sentuh
│       │   ├── selectionBar.js # Bilah aksi mengambang untuk multi-seleksi berkas
│       │   ├── trackRow.js     # Baris daftar lagu dengan badge tier kualitas
│       │   └── playerBar.js    # Player bar bawah, visualizer spektrum, dan modal Now Playing
│       └── views/
│           ├── libraryView.js  # Tampilan daftar lagu utama dengan virtual rendering
│           ├── albumsView.js   # Tampilan galeri album musik
│           ├── artistsView.js  # Tampilan daftar artis
│           ├── playlistsView.js# Tampilan manajemen playlist manual dan playlist cerdas
│           ├── queueView.js    # Tampilan antrean pemutaran lagu
│           ├── analysisView.js # Dashboard hasil analisis spektrum keaslian Hi-Res
│           └── settingsView.js # Pengaturan aplikasi, equalizer DSP, tema, dan pencadangan
└── tests/
    ├── test.html               # Runner unit test visual berbasis web browser
    ├── run-cli.js              # Runner unit test terminal Node.js
    ├── check-imports.js        # Verifikator integritas berkas import ES Modules
    ├── tiers.test.js           # Pengujian klasifikasi tier kualitas
    ├── queue.test.js           # Pengujian manajemen antrean
    ├── smartRules.test.js      # Pengujian logika Smart Playlist
    ├── m3u.test.js             # Pengujian serialisasi dan parser playlist M3U
    ├── dedupe.test.js          # Pengujian deteksi duplikat lagu
    └── lyrics.test.js          # Pengujian parser lirik LRC (offset, tag ganda, word timestamps)
```

---

## Pintasan Navigasi Keyboard

Untuk kenyamanan pengguna desktop dan kemudahan aksesibilitas tanpa mouse, tersedia pintasan keyboard global:

| Tombol Pintasan | Fungsi |
| :--- | :--- |
| **Spasi** atau **K** | Putar atau jeda pemutaran musik (Play / Pause) |
| **Panah Kanan** | Lompat maju 5 detik |
| **Panah Kiri** | Lompat mundur 5 detik |
| **Shift + Panah Kanan** | Putar lagu berikutnya di antrean |
| **Shift + Panah Kiri** | Putar lagu sebelumnya di antrean |
| **Panah Atas** | Naikkan volume suara sebesar 5% |
| **Panah Bawah** | Turunkan volume suara sebesar 5% |
| **M** | Bisukan suara (Mute) atau aktifkan kembali (Unmute) |
| **L** | Buka/tutup tab atau panel lirik tersinkronisasi |
| **Q** | Buka/tutup panel antrean lagu |
| **F** | Langsung fokus ke kolom pencarian lagu |
| **Escape** | Tutup pemutar layar penuh, panel samping, atau menu konteks |
| **Tab** / **Shift + Tab** | Berpindah fokus antar tombol dan kontrol interaktif |

---

## Aksesibilitas (WCAG AA Compliance)

HiFiLocal menerapkan standar aksesibilitas web modern:
1. **Rasio Kontras Teks (WCAG AA)**: Seluruh teks antarmuka memenuhi batas kontras minimum 4.5:1 terhadap latar belakang gelap. Palet ambient dinamis yang diekstrak dari gambar sampul otomatis dikunci nilai kecerahan (*luminance*) dan kejenuhan (*saturation*) agar teks selalu terbaca jelas.
2. **Cincin Fokus Jelas (`:focus-visible`)**: Semua tombol, slider, tab, dan tautan memiliki indikator fokus emas dengan specular glow berdaya kontras tinggi saat dinavigasi menggunakan tombol Tab keyboard.
3. **Ukuran Target Sentuh (Minimum 44x44px)**: Komponen navigasi sentuh, tombol kontrol mini player, chip filter, dan tab layar penuh mematuhi standar ukuran target sentuh minimum WCAG 2.5.5 / 2.5.8 untuk mencegah salah sentuh pada perangkat layar sentuh.
4. **Semantik & ARIA**: Semua slider durasi dan volume dilengkapi atribut `role="slider"`, `aria-label`, `aria-valuemin`, `aria-valuemax`, dan `aria-valuenow`. Tombol aksi dilengkapi label kontekstual untuk pembaca layar (*screen reader*).
5. **Tautan Langsung Konten**: Tersedia tautan lompat (`skip-link`) di awal dokumen untuk langsung menuju konten utama panggung pemutar tanpa harus melewati bilah navigasi.

---

## Klasifikasi Tier Kualitas & Verifikasi Keaslian

### Klasifikasi Tier Berdasarkan Parameter Header
HiFiLocal membaca parameter biner file audio asli (codec, bit depth, sample rate, bitrate):
- **DSD**: Berkas DSF / DFF (1-bit Direct Stream Digital).
- **HI-RES**: Format lossless (FLAC, WAV, ALAC, AIFF) dengan spesifikasi minimal 24-bit dan sample rate minimal 88.2 kHz (badge emas audiophile).
- **STUDIO**: Format lossless 24-bit pada sample rate 44.1 kHz atau 48 kHz.
- **LOSSLESS**: Format lossless 16-bit pada 44.1 kHz atau 48 kHz (kualitas standar Compact Disc).
- **LOSSY HQ**: Format terkompresi lossy (MP3, AAC, OGG, Opus) dengan bitrate minimal 256 kbps.
- **LOSSY**: Format lossy di bawah 256 kbps.

### Verifikasi Spektrum Keaslian Audio
Banyak berkas yang dipasarkan sebagai "24-bit/96kHz Hi-Res" di internet sebenarnya merupakan hasil *upsample* dari rekaman CD 44.1kHz atau hasil *transcode* dari MP3. HiFiLocal menguji keaslian fisik spektrum frekuensi di Web Worker:
1. Decode cuplikan audio pada sample rate asli file menggunakan `OfflineAudioContext`.
2. Lakukan transformasi FFT (ukuran jendela 16.384 sampel dengan fungsi jendela Hann) pada bagian aktif audio.
3. Estimasi *noise floor* dan deteksi batas frekuensi *cutoff* nyata serta rasio energi frekuensi terhadap batas Nyquist.
4. Klasifikasi hasil:
   - **Terverifikasi Hi-Res**: Energi spektral harmonik berlanjut melampaui 22.05 kHz tanpa dinding cutoff artifisial.
   - **Diduga Upsample**: File bersampel rate tinggi (>= 88.2 kHz) tetapi kandungan frekuensi terpotong tajam di sekitar 20 - 22.5 kHz.
   - **Diduga Transcode Lossy**: File berformat lossless namun spektrumnya menunjukkan dinding cutoff tajam di sekitar 15 - 20 kHz khas kompresi MP3/AAC.

---

## Batasan Teknis Peramban Web

| Aspek Audio | Batasan Peramban Web | Penanganan & Solusi HiFiLocal |
| :--- | :--- | :--- |
| **Driver Eksklusif & Mode Pure (tanpa DSP)** | Browser tidak diizinkan mengakses driver eksklusif sistem (*WASAPI Exclusive*, *Kernel Streaming*, atau *ASIO*) karena batasan keamanan sandboxing OS. | Audiophile menyajikan mode **Pure (tanpa DSP)** dengan panel **Signal Path** transparan yang membandingkan sample rate file sumber dengan sample rate audio context browser untuk memberi tahu secara jujur jika terjadi resampling oleh OS. |
| **Bitstream Native DSD (DSF/DFF)** | HTML5 Audio browser tidak mendukung decoding langsung bitstream 1-bit DSD ke hardware tanpa konversi. | File DSF/DFF dideteksi, di-parse headernya, diberi label tier DSD, dan status keterbatasan browser diinformasikan secara jelas. |
| **Dukungan File System API** | Safari / iOS belum mendukung `window.showDirectoryPicker`. | Tersedia fallback otomatis menggunakan `<input type="file" webkitdirectory>` serta Drag and Drop berkas folder yang bekerja lintas platform. |
| **Izin Akses File Handle** | Peramban dapat meminta konfirmasi ulang izin baca handle saat aplikasi dibuka kembali setelah peramban ditutup. | Handle direktori disimpan di IndexedDB dan izin diverifikasi secara mulus saat interaksi pertama pengguna. |
