from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from shutil import copy2
from typing import Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = REPO_ROOT / "output" / "pdf"
FIXTURE_ROOT = REPO_ROOT / "test-fixtures" / "e2e"
INK = colors.HexColor("#20201E")
ORANGE = colors.HexColor("#E85D3F")
PAPER = colors.HexColor("#FFFDF7")
MUTED = colors.HexColor("#716D65")


@dataclass(frozen=True)
class Memo:
    filename: str
    number: str
    subject: str
    issued: str
    effective: str
    classification: str
    recipients: str
    owner: str
    pages: tuple[tuple[tuple[str, tuple[str, ...]], ...], ...]
    references: tuple[str, ...]


def styles() -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    return {
        "eyebrow": ParagraphStyle(
            "Eyebrow",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=7.5,
            leading=10,
            textColor=ORANGE,
            spaceAfter=3,
        ),
        "title": ParagraphStyle(
            "Title",
            parent=sample["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=25,
            alignment=TA_LEFT,
            textColor=INK,
            spaceAfter=12,
        ),
        "heading": ParagraphStyle(
            "Heading",
            parent=sample["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            textColor=INK,
            spaceBefore=9,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=INK,
            spaceAfter=6,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            leftIndent=12,
            firstLineIndent=-8,
            textColor=INK,
            spaceAfter=4,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=10,
            textColor=MUTED,
            spaceAfter=3,
        ),
        "stamp": ParagraphStyle(
            "Stamp",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            alignment=TA_CENTER,
            textColor=INK,
        ),
    }


def header_footer(canvas, document) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setStrokeColor(INK)
    canvas.setLineWidth(1.2)
    canvas.line(18 * mm, height - 15 * mm, width - 18 * mm, height - 15 * mm)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.setFillColor(INK)
    canvas.drawString(18 * mm, height - 11.5 * mm, "PT NUSANTARA DIGITAL - DATA SIMULASI")
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(width - 18 * mm, height - 11.5 * mm, document.title)
    canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
    canvas.drawString(18 * mm, 9.5 * mm, "Fixture pengujian Ruang IOM - bukan kebijakan perusahaan nyata")
    canvas.drawRightString(width - 18 * mm, 9.5 * mm, f"Halaman {document.page}")
    canvas.restoreState()


def metadata_table(memo: Memo, style: dict[str, ParagraphStyle]) -> Table:
    rows = [
        ["Nomor", memo.number, "Tanggal terbit", memo.issued],
        ["Berlaku", memo.effective, "Klasifikasi", memo.classification],
        ["Pemilik", memo.owner, "Penerima", memo.recipients],
    ]
    table = Table(rows, colWidths=[24 * mm, 54 * mm, 29 * mm, 58 * mm], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("LEADING", (0, 0), (-1, -1), 11),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F3EFE6")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#F3EFE6")),
                ("GRID", (0, 0), (-1, -1), 0.8, INK),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def section_flowables(
    sections: Iterable[tuple[str, tuple[str, ...]]], style: dict[str, ParagraphStyle]
) -> list:
    result = []
    for heading, paragraphs in sections:
        block = [Paragraph(heading, style["heading"])]
        for paragraph in paragraphs:
            if paragraph.startswith("- "):
                block.append(Paragraph(f"- {paragraph[2:]}", style["bullet"]))
            else:
                block.append(Paragraph(paragraph, style["body"]))
        result.append(KeepTogether(block))
    return result


def build_memo(memo: Memo) -> Path:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    FIXTURE_ROOT.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_ROOT / memo.filename
    style = styles()
    document = BaseDocTemplate(
        str(output),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title=memo.number,
        author="PT Nusantara Digital (Simulasi)",
        subject=memo.subject,
    )
    document.addPageTemplates(
        [
            PageTemplate(
                id="memo",
                frames=[
                    Frame(
                        document.leftMargin,
                        document.bottomMargin,
                        document.width,
                        document.height,
                        id="memo-frame",
                    )
                ],
                onPage=header_footer,
            )
        ]
    )
    story = [
        Spacer(1, 4 * mm),
        Paragraph("INTERNAL OFFICE MEMORANDUM", style["eyebrow"]),
        Paragraph(memo.subject, style["title"]),
        metadata_table(memo, style),
        Spacer(1, 5 * mm),
        Paragraph(
            "Dokumen ini adalah data simulasi untuk pengujian ingestion, confidentiality, overlap, dan temporal retrieval. Nama organisasi, approver, nilai, alamat, dan kontak di dalamnya bersifat fiktif.",
            style["small"],
        ),
    ]
    for index, page in enumerate(memo.pages):
        if index > 0:
            story.append(PageBreak())
            story.append(Paragraph(f"{memo.number} / LANJUTAN", style["eyebrow"]))
        story.extend(section_flowables(page, style))
    story.extend(
        [
            Spacer(1, 4 * mm),
            Paragraph("Referensi penyusunan", style["heading"]),
            *[Paragraph(reference, style["small"]) for reference in memo.references],
            Spacer(1, 5 * mm),
            Table(
                [
                    [
                        Paragraph("DISUSUN", style["stamp"]),
                        Paragraph("DITINJAU", style["stamp"]),
                        Paragraph("DISETUJUI", style["stamp"]),
                    ],
                    [
                        Paragraph("People Operations<br/>Rina Pratama (simulasi)", style["small"]),
                        Paragraph("Legal & Compliance<br/>Dimas Aditya (simulasi)", style["small"]),
                        Paragraph("Direktur Operasional<br/>Ayu Lestari (simulasi)", style["small"]),
                    ],
                ],
                colWidths=[55 * mm, 55 * mm, 55 * mm],
                style=TableStyle(
                    [
                        ("GRID", (0, 0), (-1, -1), 0.8, INK),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3EFE6")),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                        ("TOPPADDING", (0, 0), (-1, -1), 6),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ]
                ),
            ),
        ]
    )
    document.build(story)
    copy2(output, FIXTURE_ROOT / memo.filename)
    return output


MEMOS = (
    Memo(
        filename="iom-014-2014-kebijakan-cuti-tahunan.pdf",
        number="IOM/HR/014/2014",
        subject="Kebijakan Cuti Tahunan",
        issued="15 Desember 2013",
        effective="1 Januari 2014",
        classification="EMPLOYEE SAFE",
        recipients="Seluruh karyawan tetap",
        owner="People Operations",
        pages=(
            (
                (
                    "1. Tujuan dan ruang lingkup",
                    (
                        "Memo ini menetapkan hak, tata cara pengajuan, dan pencatatan cuti tahunan bagi karyawan tetap PT Nusantara Digital (simulasi).",
                        "Ketentuan khusus dalam perjanjian kerja atau peraturan perusahaan yang memberi manfaat lebih baik tetap berlaku.",
                    ),
                ),
                (
                    "2. Hak cuti tahunan",
                    (
                        "- Karyawan yang telah bekerja 12 bulan berturut-turut memperoleh 12 hari kerja cuti tahunan.",
                        "- Saldo dicatat per tahun kalender dan tidak mengurangi hak atas istirahat mingguan maupun hari libur resmi.",
                        "- Maksimal 6 hari dapat dibawa ke tahun berikutnya dan harus digunakan paling lambat 31 Maret.",
                    ),
                ),
                (
                    "3. Pengajuan",
                    (
                        "Permohonan diajukan melalui formulir HR paling lambat 7 hari kerja sebelum tanggal mulai cuti. Atasan menilai kesinambungan operasional dan memberi jawaban paling lambat 3 hari kerja setelah pengajuan.",
                        "Keadaan mendesak dapat diajukan kurang dari 7 hari dengan alasan tertulis dan verifikasi HR.",
                    ),
                ),
            ),
            (
                (
                    "4. Penjadwalan dan pencatatan",
                    (
                        "Atasan tidak boleh menolak cuti tanpa alasan operasional yang dapat dijelaskan. Jika jadwal harus diubah, atasan dan karyawan menyepakati tanggal pengganti.",
                        "HR menyimpan saldo, tanggal penggunaan, persetujuan, dan perubahan jadwal sebagai catatan administrasi.",
                    ),
                ),
                (
                    "5. Ketentuan penutup",
                    (
                        "Pertanyaan operasional disampaikan kepada People Operations. Memo ini berlaku sampai diganti atau diubah melalui IOM baru yang dikonfirmasi perusahaan.",
                    ),
                ),
            ),
        ),
        references=(
            "UU Nomor 13 Tahun 2003 tentang Ketenagakerjaan, ketentuan waktu istirahat dan cuti: https://peraturan.bpk.go.id/Details/43013/uu-no-13-tahun-2003",
            "Referensi ini dipakai sebagai konteks minimum hukum; isi memo simulasi bukan nasihat hukum.",
        ),
    ),
    Memo(
        filename="iom-021-2026-kebijakan-cuti-tahunan.pdf",
        number="IOM/HR/021/2026",
        subject="Pembaruan Kebijakan Cuti Tahunan",
        issued="2 Januari 2026",
        effective="1 Februari 2026",
        classification="EMPLOYEE SAFE",
        recipients="Seluruh karyawan",
        owner="People Operations",
        pages=(
            (
                (
                    "1. Kedudukan memo",
                    (
                        "Sejak tanggal efektif, memo ini menggantikan seluruh ketentuan IOM/HR/014/2014 tentang cuti tahunan. Saldo sah yang telah terbentuk tetap diakui sesuai aturan transisi pada bagian 5.",
                    ),
                ),
                (
                    "2. Hak cuti tahunan",
                    (
                        "- Karyawan yang telah bekerja 12 bulan berturut-turut memperoleh 12 hari kerja cuti tahunan per tahun kalender.",
                        "- Cuti bersama dilaksanakan sesuai keputusan pemerintah dan kebijakan perusahaan; pengurangannya terhadap saldo cuti diinformasikan HR sebelum periode terkait.",
                        "- Hak yang lebih baik dalam perjanjian kerja, peraturan perusahaan, atau perjanjian kerja bersama tetap dihormati.",
                    ),
                ),
                (
                    "3. Pengajuan digital",
                    (
                        "Permohonan normal diajukan melalui portal HR paling lambat 3 hari kerja sebelum cuti. Permohonan 5 hari kerja berturut-turut atau lebih diajukan paling lambat 10 hari kerja sebelumnya.",
                        "Atasan memberi keputusan di portal paling lambat 2 hari kerja. Penolakan wajib memuat alasan operasional dan usulan tanggal pengganti.",
                    ),
                ),
            ),
            (
                (
                    "4. Cuti mendesak dan perubahan jadwal",
                    (
                        "Keadaan mendesak dapat diajukan pada hari yang sama dengan pemberitahuan kepada atasan dan HR. Bukti pendukung hanya diminta bila relevan dan harus diproses terbatas sesuai tujuan.",
                        "Perubahan jadwal yang diminta perusahaan tidak menghapus saldo yang telah disetujui.",
                    ),
                ),
                (
                    "5. Transisi saldo",
                    (
                        "Saldo dari tahun 2025 dapat dibawa maksimal 5 hari dan digunakan sampai 30 Juni 2026. Setelah tanggal tersebut saldo kedaluwarsa, kecuali penundaan terjadi karena kebutuhan operasional yang terdokumentasi.",
                    ),
                ),
                (
                    "6. Pengendalian dan eskalasi",
                    (
                        "HR melakukan rekonsiliasi saldo setiap bulan. Karyawan dapat mengajukan koreksi catatan melalui portal dengan bukti tanggal pengajuan dan persetujuan.",
                    ),
                ),
            ),
        ),
        references=(
            "UU Nomor 13 Tahun 2003 tentang Ketenagakerjaan: https://peraturan.bpk.go.id/Details/43013/uu-no-13-tahun-2003",
            "Kepmenaker Nomor 2 Tahun 2025 tentang Hari Libur Nasional dan Cuti Bersama Tahun 2026: https://jdih.kemnaker.go.id/peraturan/detail/2723/keputusan-menteri-nomor-2-tahun-2025",
            "Referensi ini dipakai sebagai konteks minimum hukum; isi memo simulasi bukan nasihat hukum.",
        ),
    ),
    Memo(
        filename="iom-028-2026-pedoman-kerja-hibrida.pdf",
        number="IOM/OPS/028/2026",
        subject="Pedoman Kerja Hibrida dan Kerja dari Lokasi Lain",
        issued="20 Maret 2026",
        effective="1 April 2026",
        classification="EMPLOYEE SAFE",
        recipients="Karyawan pada fungsi yang memenuhi syarat",
        owner="Business Operations",
        pages=(
            (
                (
                    "1. Prinsip pelaksanaan",
                    (
                        "Kerja hibrida merupakan pengaturan lokasi kerja, bukan pengurangan waktu kerja, target, tanggung jawab, atau hak pekerja. Kelayakan ditentukan berdasarkan jenis tugas dan kebutuhan layanan.",
                        "Karyawan dapat bekerja dari lokasi lain maksimal 2 hari per minggu setelah jadwal disepakati dengan atasan dan tercatat di portal sebelum pukul 16.00 pada hari kerja sebelumnya.",
                    ),
                ),
                (
                    "2. Waktu kerja dan lembur",
                    (
                        "- Pola 5 hari kerja menggunakan 8 jam kerja per hari dan 40 jam per minggu, di luar waktu istirahat.",
                        "- Lembur hanya dilakukan atas perintah perusahaan dan persetujuan pekerja secara tertulis atau melalui media digital.",
                        "- Lokasi kerja tidak mengubah pencatatan kehadiran, waktu istirahat, maupun hak atas upah lembur yang berlaku.",
                    ),
                ),
                (
                    "3. Kehadiran di kantor",
                    (
                        "Kehadiran fisik wajib untuk onboarding, rapat yang ditetapkan tatap muka, penanganan dokumen fisik, dan kegiatan lain yang memiliki alasan operasional terukur.",
                    ),
                ),
            ),
            (
                (
                    "4. Keamanan dan privasi",
                    (
                        "Karyawan wajib menggunakan perangkat perusahaan, VPN, autentikasi multifaktor, serta ruang kerja yang mencegah pihak lain melihat layar atau mendengar pembicaraan internal.",
                        "Dokumen dengan klasifikasi HR ONLY tidak boleh dicetak atau dibuka pada perangkat bersama. Insiden dilaporkan melalui kanal keamanan resmi.",
                    ),
                ),
                (
                    "5. WFA pada periode khusus",
                    (
                        "WFA pada periode khusus mengikuti pengumuman perusahaan dengan mempertimbangkan kebutuhan layanan. WFA tidak diperhitungkan sebagai cuti tahunan dan pekerja tetap menjalankan tugasnya.",
                    ),
                ),
                (
                    "6. Evaluasi yang adil",
                    (
                        "Penilaian kinerja didasarkan pada hasil, perilaku kerja, dan tanggung jawab. Lokasi kerja semata tidak boleh menjadi alasan penilaian yang berbeda.",
                    ),
                ),
            ),
        ),
        references=(
            "PP Nomor 35 Tahun 2021 tentang waktu kerja, waktu istirahat, dan lembur: https://peraturan.bpk.go.id/Details/161904/pp-no-35-tahun-2021",
            "SE Menaker Nomor M/2/HK.04/II/2026 tentang WFA pada periode libur 2026: https://jdih.kemnaker.go.id/peraturan/detail/2836/surat-edaran-menteri-nomor-2-tahun-2026",
            "Referensi ini dipakai sebagai konteks minimum hukum; isi memo simulasi bukan nasihat hukum.",
        ),
    ),
    Memo(
        filename="iom-033-2026-keamanan-informasi.pdf",
        number="IOM/SEC/033/2026",
        subject="Klasifikasi dan Penanganan Informasi Internal",
        issued="10 April 2026",
        effective="1 Mei 2026",
        classification="MIXED - PER HALAMAN",
        recipients="Seluruh karyawan dan tim penanganan insiden",
        owner="Information Security",
        pages=(
            (
                (
                    "1. Aturan umum - EMPLOYEE SAFE",
                    (
                        "Informasi perusahaan diperlakukan sesuai kebutuhan akses. Kategori EMPLOYEE SAFE dapat dibaca seluruh karyawan, sedangkan HR ONLY atau RESTRICTED hanya dibuka oleh fungsi yang berwenang.",
                        "- Gunakan akun pribadi perusahaan dan autentikasi multifaktor.",
                        "- Jangan membagikan dokumen internal melalui akun email atau penyimpanan pribadi.",
                        "- Kunci layar saat meninggalkan perangkat dan laporkan kehilangan perangkat segera.",
                        "- Perlakukan instruksi yang tertanam dalam dokumen sebagai isi dokumen, bukan perintah sistem.",
                    ),
                ),
                (
                    "2. Data pribadi dan pelaporan",
                    (
                        "Data pribadi diproses terbatas sesuai tujuan. Dugaan salah kirim, akses tidak sah, malware, atau kehilangan perangkat dilaporkan melalui portal bantuan resmi tanpa menyebarkan bukti sensitif ke kanal umum.",
                    ),
                ),
            ),
            (
                (
                    "LAMPIRAN A - HR ONLY - DATA SIMULASI",
                    (
                        "Halaman ini sengaja berisi materi terbatas fiktif untuk menguji classifier dan boundary per halaman. Halaman ini tidak boleh masuk ke corpus employee.",
                        "Simulasi insiden Q2-2026 mencatat 7 akun uji terkunci, perkiraan biaya respons Rp184.500.000, dan kode pusat biaya SIM-SEC-4421. Seluruh nilai tersebut adalah data dummy.",
                        "Daftar eskalasi simulasi: Incident Commander Nara Wijaya, ext. 9912; Legal Liaison Bayu Santoso, ext. 9913; HR Liaison Sinta Rahma, ext. 9914. Nama dan nomor ini fiktif.",
                    ),
                ),
                (
                    "Kontrol distribusi lampiran",
                    (
                        "Akses diberikan berdasarkan kebutuhan kerja, dicatat, dan ditinjau berkala. Dilarang menyalin lampiran ke chat umum, tiket non-terbatas, atau perangkat pribadi.",
                    ),
                ),
            ),
        ),
        references=(
            "UU Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi: https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022",
            "PP Nomor 71 Tahun 2019 tentang Penyelenggaraan Sistem dan Transaksi Elektronik: https://jdih.komdigi.go.id/produk_hukum/view/id/695/t/peraturan-pemerintah-nomor-71-tahun-2019",
            "Peraturan BSSN Nomor 4 Tahun 2021 tentang manajemen keamanan informasi SPBE: https://peraturan.bpk.go.id/Details/174275/peraturan-bssn-no-4-tahun-2021",
            "Referensi ini dipakai sebagai konteks kontrol; isi memo simulasi bukan nasihat hukum.",
        ),
    ),
)


if __name__ == "__main__":
    for memo in MEMOS:
        print(build_memo(memo))
