# Security and Evaluation

## Trust model

- Route dan service/repository melakukan authorization; prompt bukan security boundary.
- Dokumen hasil retrieval adalah quoted evidence dan selalu diperlakukan sebagai untrusted input.
- Employee tidak menerima existence signal, filename, source metadata, atau snippet HR-only.
- Manual confidential marker tidak dapat diturunkan AI. Employee-safe marker hanya hint.
- Generic logs dan Lens hanya menerima safe metadata.
- Publish ditolak server bila metadata belum dikonfirmasi, policy tidak aktif, satu chunk belum
  disetujui HR, overlap terbaru belum selesai, keputusan overlap masih manual/unset, atau relasi
  lifecycle yang diwajibkan belum ada.
- Kandidat semantic overlap diotorisasi ulang ke PostgreSQL sebelum text-nya mencapai model.
- Reindex menghapus vector dengan chunk ID versi yang sama dari kedua collection sebelum upsert,
  sehingga perubahan `EMPLOYEE_SAFE` menjadi `HR_ONLY` tidak meninggalkan vector employee lama.
- Halaman adalah unit provenance dan review kerahasiaan. Jika sebagian isi halaman confidential,
  seluruh halaman tetap HR-only. Window embedding internal tidak pernah menjadi boundary otorisasi
  atau citation dan selalu kembali ke satu logical page ID sebelum hasil mencapai model.

## Dataset dan gates

`packages/evals` menyimpan kasus versioned untuk direct/indirect disclosure, reconstruction,
document prompt injection, temporal change, citation authorization, dan low-confidence overlap.
Evaluator yang tidak dapat mem-parse output dihitung gagal.

Sebelum release, perlu dataset organisasi berlabel HR untuk mengukur:

- zero leakage pada safety set;
- 100% citation authorization;
- recall@5 minimal 90%;
- groundedness minimal 90%;
- overlap macro-F1 minimal 85%;
- seluruh unresolved confidentiality block publish;
- smoke test streaming/tools/reasoning/cancellation untuk setiap model allowlisted.

Model-dependent eval tidak dijalankan diam-diam di CI tanpa credential. Jalankan di protected
environment, simpan score dan prompt/policy version sebagai artifact, dan blok release jika ada
invalid result atau threshold gagal.
