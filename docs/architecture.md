# Architecture

## Boundary utama

`platform` hanya memahami contract publik. `api` menjadi authentication, authorization, dan
stream-projection boundary. `worker` menjalankan pekerjaan berat melalui lease PostgreSQL.
`agents` hanya menerima model, retrieval, scope actor, memory, dan observability melalui injection.

Employee dan HR memakai collection Qdrant terpisah. Setiap hasil retrieval tetap diotorisasi ulang
ke PostgreSQL terhadap status version, visibility, effective date, dan active policy generation.
Browser tidak pernah menerima raw provider event, continuation, storage key, vector filter, atau
internal model payload.

## Alur dokumen

1. API memvalidasi signature/ukuran, menyimpan original melalui `FileStorage`, lalu membuat record dan
   job secara transaksional. Original dibersihkan bila transaksi gagal.
2. Batch membawa jumlah file yang diharapkan dan ditutup (`sealed`) setelah transfer selesai, sehingga
   stream progress dapat berakhir dengan benar termasuk ketika seluruh file ditolak.
3. Durable job mengekstrak PDF/DOCX/Markdown/TXT; halaman tanpa text layer memakai OCR lokal.
4. Satu halaman non-kosong menjadi satu chunk/evidence logis dengan stable ID dari content dan nomor
   halaman. PDF mempertahankan halaman fisik; DOCX/Markdown/TXT tanpa informasi layout diperlakukan
   sebagai satu halaman logis.
5. Halaman panjang dibagi hanya pada lapisan embedding menjadi window pendek yang overlap. Qdrant
   menyimpan beberapa vector point, tetapi semuanya memakai satu logical page ID dan hasil search
   dideduplikasi kembali ke halaman. Ini mencegah bagian bawah halaman terpotong batas model.
6. Anvia structured classifier menerapkan policy natural-language beserta marker HR. Karena review
   mengikuti unit halaman, satu bagian confidential membuat seluruh halaman konservatif/HR-only.
7. Conflict, low-confidence, dan OCR rendah berhenti di `NEEDS_REVIEW`. Semua keputusan—termasuk
   hasil confidence tinggi—harus memiliki jejak persetujuan HR.
8. Metadata yang dikonfirmasi, review kerahasiaan lengkap, overlap terbaru yang selesai, dan relasi
   yang diwajibkan keputusannya merupakan satu publish-readiness gate server-side.
9. Publish yang dikonfirmasi HR mengubah target `REPLACES` yang masih published menjadi
   `SUPERSEDED`, lalu worker melakukan embedding/indexing. Reindex menghapus ID vector lama sebelum
   upsert agar perubahan visibility tidak meninggalkan vector employee yang basi.

## Alur chat

Chat baru dimulai sebagai draft lokal di browser dan tidak membuat row `Conversation`. Pada pesan
pertama yang memiliki teks user, API memvalidasi actor, scope, model, policy, dan corpus lalu
membuat conversation beserta request message secara atomik. Draft yang ditutup tanpa pesan tidak
meninggalkan session kosong; setelah commit, response memberi session ID agar browser mengganti URL
secara in-place tanpa remount stream. Migration cleanup juga menghapus row legacy tanpa message.

Allowlist runtime saat ini hanya berisi `gpt-5.6-luna` dengan reasoning `high` untuk chat,
confidentiality, dan overlap; tidak ada fallback model atau stub pada jalur production. Scoped
`search_iom` membentuk filter dari actor,
bukan argumen model. Agent maksimal empat turn dan harus abstain tanpa evidence. Anvia Client
Protocol v3 memproyeksikan reasoning summary, tool status, source, dan answer ke JSONL. Rolling
release guard menahan delta pendek dan membatalkan run bila normalized confidential fingerprint
terdeteksi.

## Versioning temporal

`IomDocument` adalah identitas aturan; `IomVersion` adalah revisinya. Upload baru dapat dikaitkan
ke versi sebelumnya sebelum publish. Relasi `REPLACES`, `COMPLEMENTS`, dan
`PARTIALLY_OVERRIDES` hanya berlaku setelah keputusan HR. Keputusan disimpan sebagai satu row aktif
yang dapat diperbarui sebelum publish, sedangkan setiap perubahan dicatat sebagai `AuditEvent`.
`MANUAL_REVIEW` hanya status sementara dan tidak pernah menjadi outcome final.

Overlap memakai seluruh halaman draft sebagai probe (window 800 karakter dengan overlap 100), lalu
memadukan semantic, lexical, dan explicit candidates. Semua chunk existing dibaca ulang dari
PostgreSQL dan dire-authorize sebelum masuk ke model. Hasil model material wajib memiliki evidence
dari kedua versi; confidence rendah, conflict, provenance invalid, atau coverage terpotong dipaksa
ke review HR. Run tanpa kandidat tetap membutuhkan konfirmasi HR.

`REPLACES` baru membentuk supersede ketika publish. `PARTIALLY_OVERRIDES` menyimpan `topicScope`
dan mempertahankan versi lama published untuk topik lain; `COMPLEMENTS` mempertahankan keduanya.
Kemiripan semantik tidak pernah otomatis berarti menggantikan.
