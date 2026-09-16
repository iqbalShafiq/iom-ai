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
4. Stable chunk ID dibentuk dari normalized content dan posisi. Panjang text, chunk, dan panggilan AI
   memiliki batas eksplisit.
5. Anvia structured classifier menerapkan policy natural-language beserta marker HR.
6. Conflict, low-confidence, dan OCR rendah berhenti di `NEEDS_REVIEW`. Semua keputusan—termasuk
   hasil confidence tinggi—harus memiliki jejak persetujuan HR.
7. Metadata yang dikonfirmasi, review kerahasiaan lengkap, overlap terbaru yang selesai, dan relasi
   yang diwajibkan keputusannya merupakan satu publish-readiness gate server-side.
8. Publish yang dikonfirmasi HR mengubah target `REPLACES` yang masih published menjadi
   `SUPERSEDED`, lalu worker melakukan embedding/indexing. Reindex menghapus ID vector lama sebelum
   upsert agar perubahan visibility tidak meninggalkan vector employee yang basi.

## Alur chat

Model dan reasoning dipilih dari allowlist server. Scoped `search_iom` membentuk filter dari actor,
bukan argumen model. Agent maksimal empat turn dan harus abstain tanpa evidence. Anvia Client
Protocol v3 memproyeksikan reasoning summary, tool status, source, dan answer ke JSONL. Rolling
release guard menahan delta pendek dan membatalkan run bila normalized confidential fingerprint
terdeteksi.

## Versioning temporal

`IomDocument` adalah identitas aturan; `IomVersion` adalah revisinya. Upload baru dapat dikaitkan
ke versi sebelumnya sebelum publish. Relasi `REPLACES`, `COMPLEMENTS`, dan
`PARTIALLY_OVERRIDES` hanya berlaku setelah keputusan HR. Kemiripan semantik tidak pernah otomatis
berarti menggantikan.

Keputusan overlap `ARCHIVE_EXISTING` membentuk relasi `REPLACES`, sedangkan
`PUBLISH_AS_COMPLEMENT` membentuk `COMPLEMENTS`. Perubahan status target tetap baru terjadi dalam
transaksi publish yang dikonfirmasi HR, bukan ketika model menghasilkan rekomendasi.
