# Security and Evaluation

## Trust model

- Route dan service/repository melakukan authorization; prompt bukan security boundary.
- Dokumen hasil retrieval adalah quoted evidence dan selalu diperlakukan sebagai untrusted input.
- Employee tidak menerima existence signal, filename, source metadata, atau snippet HR-only.
- Manual confidential marker tidak dapat diturunkan AI. Employee-safe marker hanya hint.
- Generic logs dan telemetry hanya menerima payload yang sudah di-mask. Credential, cookie,
  authorization header, database URL, storage key, raw provider payload, dan chain-of-thought
  tidak boleh diekspor.
- Publish ditolak server bila metadata belum dikonfirmasi, policy tidak aktif, satu chunk belum
  disetujui HR, coverage overlap belum lengkap, zero-match belum dikonfirmasi, keputusan overlap
  masih pending/unset, evidence stale, atau relasi lifecycle yang diwajibkan belum ada.
- Kandidat semantic overlap diotorisasi ulang ke PostgreSQL sebelum text-nya mencapai model.
- Reindex menghapus vector dengan chunk ID versi yang sama dari kedua collection sebelum upsert,
  sehingga perubahan `EMPLOYEE_SAFE` menjadi `HR_ONLY` tidak meninggalkan vector employee lama.
- Halaman adalah unit provenance dan review kerahasiaan. Jika sebagian isi halaman confidential,
  seluruh halaman tetap HR-only. Window embedding internal tidak pernah menjadi boundary otorisasi
  atau citation dan selalu kembali ke satu logical page ID sebelum hasil mencapai model.

## Dataset dan gates

`packages/evals` menyimpan kasus versioned untuk direct/indirect disclosure, reconstruction,
document prompt injection, temporal change, citation authorization, scoped partial override, zero
candidate confirmation, provenance invalid, dan low-confidence overlap.
Evaluator yang tidak dapat mem-parse output dihitung gagal.

Sebelum release, perlu dataset organisasi berlabel HR untuk mengukur:

- zero leakage pada safety set;
- 100% citation authorization;
- recall@5 minimal 90%;
- groundedness minimal 90%;
- overlap macro-F1 minimal 85%;
- seluruh unresolved confidentiality block publish;
- smoke test streaming/tools/reasoning/cancellation untuk setiap model allowlisted.

Allowlist aktif hanya `deepseek-v4-flash-0731` dengan reasoning `high` untuk candidate dan judge.
Capability smoke test protected harus mencakup structured confidentiality, structured overlap
dengan provenance valid, serta chat yang benar-benar memanggil retrieval; hasil stub atau mock
tidak memenuhi release gate model-dependent.

Agent-quality evaluation memakai `runEvalSuite` plus LLM judge, G-Eval, faithfulness,
hallucination, abstention, dan rubric domain. `exactMatch`/`contains` tetap hanya untuk
security invariant, bukan kualitas jawaban. Invalid evaluator output dihitung gagal.

Model-dependent eval tidak dijalankan diam-diam di CI tanpa credential. Jalankan secara manual
selama development (`pnpm eval:smoke`, `pnpm eval:confidentiality`, `pnpm eval:overlap`,
`pnpm eval:chat`). Simpan score dan prompt/policy version sebagai artifact Langfuse experiment
bila tracing diaktifkan.
