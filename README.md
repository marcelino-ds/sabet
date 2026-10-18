# Sabet

Extension Chrome/Edge buat kuis Moodle. Jawabannya dari Gemini, ChatGPT, atau Claude.

Baca soal, isi jawaban, klik cek kalau ada. Tombol kirim tetap kamu.

## Pasang

Node 24+.

```sh
npm ci
npm run build
```

`chrome://extensions` atau `edge://extensions`. Nyalain developer mode, Load unpacked, pilih folder `dist`.

Ubah kode? `npm run build`, terus Reload.

## Pakai

Buka halaman soal, klik Sabet, pilih AI, Mulai.

Login Gemini/ChatGPT/Claude dulu di browser yang sama. Sabet buka tab AI-nya sendiri dan ngetik soalnya di situ.

`npm test` buat ngetes. Tes di browser: `npm run test:browser`. Edge yang udah terpasang:

```powershell
$env:SABET_BROWSER_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
```
