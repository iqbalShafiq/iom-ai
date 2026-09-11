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

1. API memvalidasi signature/ukuran lalu menyimpan original melalui `FileStorage`.
2. Durable job mengekstrak PDF/DOCX/Markdown/TXT; halaman tanpa text layer memakai OCR lokal.
3. Stable chunk ID dibentuk dari normalized content dan posisi.
4. Anvia structured classifier menerapkan policy natural-language beserta marker HR.
5. Conflict, low-confidence, dan OCR rendah berhenti di `NEEDS_REVIEW`.
6. HR menyelesaikan review dan publish; worker baru kemudian melakukan embedding/indexing.

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
