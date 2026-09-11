# Security and Evaluation

## Trust model

- Route dan service/repository melakukan authorization; prompt bukan security boundary.
- Dokumen hasil retrieval adalah quoted evidence dan selalu diperlakukan sebagai untrusted input.
- Employee tidak menerima existence signal, filename, source metadata, atau snippet HR-only.
- Manual confidential marker tidak dapat diturunkan AI. Employee-safe marker hanya hint.
- Generic logs dan Lens hanya menerima safe metadata.

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
