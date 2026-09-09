# Sabet

Ekstensi Chrome dan Edge untuk membantu mengerjakan kuis Moodle dengan Gemini, ChatGPT, atau Claude.

**Versi 1.0.0** merupakan rilis awal Sabet. Ekstensi membaca soal, meminta jawaban ke AI pilihanmu, mengisi jawaban, dan menjalankan pemeriksaan yang tersedia. Pengiriman akhir kuis tetap dilakukan sendiri.

## Fitur

- Pilihan Gemini, ChatGPT, dan Claude melalui akun AI atau kunci API sendiri.
- Dukungan soal pilihan, teks, menjodohkan, esai, serta CodeRunner dengan isian dan editor Ace.
- Catatan tambahan untuk mengarahkan jawaban AI.
- Progres pengerjaan dan tombol **Hentikan** selama proses berjalan.
- Melanjutkan sesi setelah halaman dimuat ulang, tanpa mengirim permintaan yang sama dua kali.
- Menghentikan proses jika jawaban diedit sendiri saat AI masih bekerja.

## Pemasangan

Siapkan Node.js 24 atau lebih baru, Git, serta Chrome atau Edge.

```sh
git clone https://github.com/marcelino-ds/sabet.git
cd sabet
npm ci
npm run build
```

1. Buka `chrome://extensions` di Chrome atau `edge://extensions` di Edge.
2. Aktifkan **Developer mode** atau **Mode pengembang**.
3. Pilih **Load unpacked** atau **Muat yang belum dikemas**.
4. Pilih folder **dist** di dalam folder Sabet.
5. Sematkan Sabet ke bilah ekstensi agar mudah dibuka.

Folder `dist` dibuat saat proses build. Setelah memperbarui kode, jalankan `npm run build` kembali lalu klik **Reload** pada Sabet di halaman ekstensi.

## Cara pakai

1. Buka halaman soal kuis Moodle yang sedang dikerjakan.
2. Klik ikon Sabet dan pilih AI yang ingin digunakan.
3. Tambahkan **Catatan** jika diperlukan, misalnya "Jawab dalam bahasa Indonesia."
4. Klik **Mulai**. Gunakan **Hentikan** untuk membatalkan proses.
5. Periksa hasilnya sebelum mengirim kuis.

### Menggunakan akun AI

Buka **Pengaturan**, lalu pilih **Akun AI saya**. Pastikan kamu sudah masuk ke akun Gemini, ChatGPT, atau Claude di browser yang sama. Sabet akan menggunakan tab layanan tersebut.

### Menggunakan kunci API

Buka **Pengaturan**, pilih **Kunci API sendiri**, lalu isi kunci dan model AI. Klik **Simpan**. Kunci disimpan secara lokal di browser; penggunaan API mengikuti biaya dan batas layanan masing-masing penyedia.

## Dukungan dan batasan

Sabet mendukung halaman pengerjaan kuis Moodle melalui HTTPS. Tema khusus, editor tambahan, dan variasi konfigurasi Moodle perlu diperiksa kompatibilitasnya. Perubahan tampilan layanan AI juga dapat memengaruhi mode akun.

Untuk melaporkan masalah, buat [issue](https://github.com/marcelino-ds/sabet/issues) dengan langkah kejadian, versi browser, jenis soal, dan pesan kesalahan yang muncul. Jangan sertakan kunci API atau informasi akun.

## Pengembangan

| Perintah | Kegunaan |
| --- | --- |
| `npm run build` | Membuat ekstensi di folder `dist` |
| `npm run watch` | Memperbarui hasil build saat kode berubah |
| `npm test` | Menjalankan pengujian unit dan integrasi |
| `npm run lint` | Memeriksa kualitas kode |
| `npm run check` | Menjalankan lint, pengujian, dan build |
| `npm run test:browser` | Menguji ekstensi hasil build di browser |

Sebelum mengirim perubahan, jalankan:

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

Di Windows, pengujian juga dapat memakai Edge yang sudah terpasang:

```powershell
$env:SABET_BROWSER_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
npm run test:browser
```

Pengujian browser memakai profil terpisah dan halaman uji lokal. Cakupannya mencakup popup dari ikon ekstensi, pengaturan, pembatalan, pemulihan sesi, pengisian jawaban, dan perlindungan jawaban yang diedit sendiri.

Arah pengembangan dan kriteria penyelesaian ada di [peta jalan](docs/ROADMAP.md). Baca juga [arsitektur](docs/ARCHITECTURE.md) untuk pembagian tanggung jawab komponen dan [panduan kontribusi](CONTRIBUTING.md) untuk alur perubahan.

## Lisensi

Sabet dikembangkan dari FLAB dan menggunakan [Lisensi MIT](LICENSE). Gunakan sesuai aturan yang berlaku di kelas atau institusimu.
