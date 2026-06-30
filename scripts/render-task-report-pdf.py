#!/usr/bin/env python3
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


FONT = "ReportCJK"
FONT_CANDIDATES = [
    os.environ.get("REPORT_PDF_FONT", ""),
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
]


def register_font():
    for font_path in FONT_CANDIDATES:
        if font_path and Path(font_path).exists():
            pdfmetrics.registerFont(TTFont(FONT, font_path))
            return FONT
    return "Helvetica"


FONT_NAME = register_font()


def clean(text):
    text = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = text.replace("•", "-")
    return text.strip()


def escape(text):
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def split_sections(text):
    lines = [line.strip() for line in clean(text).split("\n") if line.strip()]
    sections = []
    current = {"title": "主要结论", "items": []}
    for line in lines:
        heading = re.match(r"^【(.+?)】\s*(.*)$", line)
        markdown_heading = re.match(r"^#{1,3}\s+(.+)$", line)
        bold_heading = re.match(r"^(.+?):$", line)
        if heading:
            if current["items"]:
                sections.append(current)
            current = {"title": heading.group(1), "items": []}
            if heading.group(2):
                current["items"].append(heading.group(2))
            continue
        if markdown_heading:
            if current["items"]:
                sections.append(current)
            current = {"title": markdown_heading.group(1), "items": []}
            continue
        if bold_heading and len(line) <= 40:
            if current["items"]:
                sections.append(current)
            current = {"title": bold_heading.group(1), "items": []}
            continue
        current["items"].append(re.sub(r"^[-*]\s*", "", line))
    if current["items"]:
        sections.append(current)
    return sections or [{"title": "主要结论", "items": ["暂无执行结果。"]}]


def summary_points(sections):
    points = []
    for section in sections:
        for item in section["items"]:
            if item and len(points) < 5:
                points.append(item)
    return points or ["暂无执行结果。"]


def build_pdf(payload, output_path):
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="CnTitle",
        fontName=FONT_NAME,
        fontSize=20,
        leading=26,
        textColor=colors.HexColor("#111827"),
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="CnSub",
        fontName=FONT_NAME,
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#6B7280"),
    ))
    styles.add(ParagraphStyle(
        name="Section",
        fontName=FONT_NAME,
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#111827"),
        spaceBefore=8,
        spaceAfter=7,
    ))
    styles.add(ParagraphStyle(
        name="Body",
        fontName=FONT_NAME,
        fontSize=9.5,
        leading=15,
        textColor=colors.HexColor("#374151"),
        alignment=TA_LEFT,
    ))
    styles.add(ParagraphStyle(
        name="Small",
        fontName=FONT_NAME,
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#6B7280"),
    ))

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=15 * mm,
        title=payload.get("title") or "任务报告",
    )

    result = clean(payload.get("resultText"))
    sections = split_sections(result)
    points = summary_points(sections)
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    task_name = payload.get("taskName") or "定时任务"
    title = payload.get("title") or f"{task_name}报告"

    story = []
    story.append(Paragraph(escape(title), styles["CnTitle"]))
    story.append(Paragraph(escape(f"{task_name} · {payload.get('cronLabel') or '未设置频率'} · 生成时间 {generated_at}"), styles["CnSub"]))
    story.append(Spacer(1, 7 * mm))

    meta = [
        [Paragraph("<b>任务名称</b>", styles["Small"]), Paragraph(escape(task_name), styles["Body"])],
        [Paragraph("<b>执行频率</b>", styles["Small"]), Paragraph(escape(payload.get("cronLabel") or "-"), styles["Body"])],
        [Paragraph("<b>上次执行</b>", styles["Small"]), Paragraph(escape(payload.get("lastRunLabel") or "-"), styles["Body"])],
    ]
    table = Table(meta, colWidths=[25 * mm, 132 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(table)
    story.append(Spacer(1, 7 * mm))

    story.append(Paragraph("主要结论", styles["Section"]))
    conclusion_rows = []
    for idx, point in enumerate(points, 1):
        conclusion_rows.append([
            Paragraph(str(idx), styles["Small"]),
            Paragraph(escape(point), styles["Body"]),
        ])
    conclusion_table = Table(conclusion_rows, colWidths=[9 * mm, 148 * mm])
    conclusion_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#ECFDF5")),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#047857")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D1FAE5")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(conclusion_table)
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("分点详情", styles["Section"]))
    for section in sections:
        story.append(Paragraph(escape(section["title"]), styles["Section"]))
        rows = []
        for item in section["items"]:
            rows.append([Paragraph("-", styles["Small"]), Paragraph(escape(item), styles["Body"])])
        detail_table = Table(rows, colWidths=[7 * mm, 150 * mm])
        detail_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#E5E7EB")),
            ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#EEF2F7")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(detail_table)
        story.append(Spacer(1, 4 * mm))

    actions = payload.get("actions") or []
    if actions:
        story.append(PageBreak())
        story.append(Paragraph("建议下一步", styles["Section"]))
        rows = []
        for idx, action in enumerate(actions, 1):
            rows.append([
                Paragraph(str(idx), styles["Small"]),
                Paragraph(escape(action.get("label") or ""), styles["Body"]),
                Paragraph(escape(action.get("agentLabel") or ""), styles["Body"]),
            ])
        action_table = Table(rows, colWidths=[9 * mm, 112 * mm, 36 * mm])
        action_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F0FDF4")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(action_table)

    def footer(canvas, doc_obj):
        canvas.saveState()
        canvas.setFont(FONT_NAME, 8)
        canvas.setFillColor(colors.HexColor("#9CA3AF"))
        canvas.drawString(18 * mm, 9 * mm, "灵枢 AI · 定时任务报告")
        canvas.drawRightString(192 * mm, 9 * mm, f"Page {doc_obj.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: render-task-report-pdf.py output.pdf")
    payload = json.loads(sys.stdin.read() or "{}")
    output = Path(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)
    build_pdf(payload, str(output))


if __name__ == "__main__":
    main()
