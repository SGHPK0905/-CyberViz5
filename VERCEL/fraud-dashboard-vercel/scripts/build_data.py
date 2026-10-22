"""Build small dashboard JSON from the cleaned IEEE-CIS Parquet file.

The script deliberately reads only the columns needed by the two user stories.
This keeps memory use predictable and makes the deployed web app independent of
the 87 MB, 437-column Parquet file.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq


NEEDED_COLUMNS = [
    "TransactionID",
    "isFraud",
    "TransactionDT",
    "TransactionDayIndex",
    "TransactionAmt",
    "ProductCD",
    "card4",
    "card6",
    "addr1",
    "D1",
    "P_emaildomain",
    "R_emaildomain",
    "DeviceType",
    "DeviceInfo",
    "id_30",
    "id_31",
    "HasIdentity",
]

MISSING_LABELS = {
    "Không xác định",
    "Không có bản ghi identity",
    "Thiếu trong bản ghi identity",
}


def clean_number(value):
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    return value


def records(frame: pd.DataFrame) -> list[dict]:
    return [
        {key: clean_number(value) for key, value in row.items()}
        for row in frame.to_dict(orient="records")
    ]


def wilson(successes: int, total: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if total <= 0:
        return 0.0, 0.0
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    margin = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
    return max(0.0, center - margin), min(1.0, center + margin)


def summarize_group(frame: pd.DataFrame) -> dict:
    total = int(len(frame))
    fraud = int(frame["isFraud"].sum())
    low, high = wilson(fraud, total)
    fraud_mask = frame["isFraud"].eq(1)
    return {
        "total": total,
        "fraud": fraud,
        "fraud_rate": fraud / total if total else 0.0,
        "ci_low": low,
        "ci_high": high,
        "amount_total": float(frame["TransactionAmt"].sum()),
        "fraud_amount": float(frame.loc[fraud_mask, "TransactionAmt"].sum()),
    }


def aggregate_period(frame: pd.DataFrame, key: str) -> list[dict]:
    result = []
    for period, group in frame.groupby(key, sort=True, observed=True):
        item = summarize_group(group)
        item[key] = int(period)
        item["day_start"] = int(group["TransactionDayIndex"].min())
        item["day_end"] = int(group["TransactionDayIndex"].max())
        result.append(item)
    return result


def manager_payload(df: pd.DataFrame) -> dict:
    working = df.copy()
    working["RelativeWeek"] = (working["TransactionDayIndex"] - 1) // 7 + 1
    working["RelativeCycleDay"] = (working["TransactionDayIndex"] - 1) % 7

    by_product = {}
    choices = ["ALL"] + sorted(working["ProductCD"].dropna().astype(str).unique().tolist())
    for product in choices:
        subset = working if product == "ALL" else working[working["ProductCD"].eq(product)]
        by_product[product] = {
            "kpi": summarize_group(subset),
            "weekly": aggregate_period(subset, "RelativeWeek"),
        }

    cycle = []
    for cycle_day, group in working.groupby("RelativeCycleDay", sort=True):
        item = summarize_group(group)
        item["cycle_day"] = int(cycle_day)
        cycle.append(item)

    product_identity = []
    for (product, has_identity), group in working.groupby(["ProductCD", "HasIdentity"], observed=True):
        item = summarize_group(group)
        item.update({"product": str(product), "has_identity": bool(has_identity)})
        product_identity.append(item)

    return {
        "by_product": by_product,
        "relative_cycle": cycle,
        "product_identity": product_identity,
    }


def missing_mask(series: pd.Series) -> pd.Series:
    mask = series.isna()
    if pd.api.types.is_string_dtype(series.dtype) or series.dtype == object:
        mask = mask | series.astype("string").isin(MISSING_LABELS)
    return mask


def investigator_payload(df: pd.DataFrame) -> dict:
    amount_edges = [0, 25, 50, 100, 200, 500, 1000, float("inf")]
    amount_labels = ["0–25", "25–50", "50–100", "100–200", "200–500", "500–1.000", ">1.000"]
    amount_group = pd.cut(
        df["TransactionAmt"], bins=amount_edges, labels=amount_labels, right=False, include_lowest=True
    )
    amount_bins = []
    for label, group in df.groupby(amount_group, observed=False):
        item = summarize_group(group)
        item["label"] = str(label)
        amount_bins.append(item)

    positive_amount = df.loc[df["TransactionAmt"].gt(0), "TransactionAmt"]
    log_edges = np.logspace(np.log10(positive_amount.min()), np.log10(positive_amount.max()), 26)
    histogram = []
    for label_value, label_name in [(0, "Hợp lệ"), (1, "Gian lận")]:
        values = df.loc[df["isFraud"].eq(label_value), "TransactionAmt"].to_numpy()
        counts, edges = np.histogram(values, bins=log_edges)
        shares = counts / counts.sum() if counts.sum() else counts
        histogram.append(
            {
                "label": label_name,
                "class_value": label_value,
                "bins": [
                    {
                        "x0": float(edges[i]),
                        "x1": float(edges[i + 1]),
                        "share": float(shares[i]),
                        "count": int(counts[i]),
                    }
                    for i in range(len(counts))
                ],
            }
        )

    missing_columns = [
        "DeviceType",
        "DeviceInfo",
        "P_emaildomain",
        "R_emaildomain",
        "card4",
        "card6",
        "addr1",
        "D1",
        "id_30",
        "id_31",
    ]
    missing_effects = []
    for column in missing_columns:
        mask = missing_mask(df[column])
        missing = df[mask]
        present = df[~mask]
        if missing.empty or present.empty:
            continue
        item = {
            "column": column,
            "missing": summarize_group(missing),
            "present": summarize_group(present),
            "missing_pct": float(mask.mean()),
        }
        item["rate_gap"] = item["missing"]["fraud_rate"] - item["present"]["fraud_rate"]
        missing_effects.append(item)
    missing_effects.sort(key=lambda x: abs(x["rate_gap"]), reverse=True)

    segment_rows = []
    segment_source = df.copy()
    segment_source["DeviceGroup"] = segment_source["DeviceType"].fillna("Không xác định")
    for (product, device), group in segment_source.groupby(["ProductCD", "DeviceGroup"], observed=True):
        if len(group) < 100:
            continue
        item = summarize_group(group)
        item.update({"product": str(product), "device": str(device)})
        segment_rows.append(item)
    segment_rows.sort(key=lambda x: (x["fraud_rate"], x["total"]), reverse=True)

    # A compact, deterministic retrospective sample for the investigation table.
    fraud_sample = df[df["isFraud"].eq(1)].nlargest(80, "TransactionAmt")
    legitimate_sample = df[df["isFraud"].eq(0)].sample(40, random_state=3123580038)
    ledger = pd.concat([fraud_sample, legitimate_sample], ignore_index=True)
    ledger = ledger[
        [
            "TransactionID",
            "isFraud",
            "TransactionDayIndex",
            "TransactionAmt",
            "ProductCD",
            "card4",
            "card6",
            "DeviceType",
            "D1",
        ]
    ].sort_values(["isFraud", "TransactionAmt"], ascending=[False, False])
    ledger = ledger.rename(
        columns={
            "TransactionID": "transaction_id",
            "isFraud": "is_fraud",
            "TransactionDayIndex": "relative_day",
            "TransactionAmt": "amount",
            "ProductCD": "product",
            "DeviceType": "device",
            "D1": "d1",
        }
    )

    return {
        "amount_bins": amount_bins,
        "amount_histogram": histogram,
        "missing_effects": missing_effects,
        "segments": segment_rows[:20],
        "ledger_sample": records(ledger),
    }


def build(source: Path, output: Path) -> None:
    parquet = pq.ParquetFile(source)
    missing = sorted(set(NEEDED_COLUMNS) - set(parquet.schema.names))
    if missing:
        raise ValueError(f"Parquet thiếu các cột bắt buộc: {missing}")

    print(f"Reading {len(NEEDED_COLUMNS)} / {len(parquet.schema.names)} columns to limit memory use...")
    df = parquet.read(columns=NEEDED_COLUMNS).to_pandas()
    if not df["isFraud"].isin([0, 1]).all():
        raise ValueError("isFraud phải chỉ gồm 0 và 1")

    overall = summarize_group(df)
    payload = {
        "metadata": {
            "project": "IEEE-CIS Fraud Detection — Dashboard hậu kiểm",
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "source_file": source.name,
            "source_rows": int(parquet.metadata.num_rows),
            "source_columns": len(parquet.schema.names),
            "loaded_columns": NEEDED_COLUMNS,
            "time_note": "TransactionDT/TransactionDayIndex là thời gian tương đối từ mốc ẩn; không suy ra ngày lịch hoặc thứ trong tuần.",
            "amount_note": "Tổng TransactionAmt của giao dịch có nhãn fraud là giá trị giao dịch gắn nhãn, không đồng nghĩa thiệt hại đã xác nhận.",
            "analysis_note": "Dashboard mô tả hậu kiểm trên tập train đã có nhãn; không phải mô hình dự báo thời gian thực.",
            "ci_method": "Wilson score interval, mức 95%",
        },
        "user_stories": {
            "manager": "Là Quản lý rủi ro, tôi muốn theo dõi tỷ lệ, số lượng và giá trị giao dịch gian lận theo thời gian và phân khúc để ưu tiên nguồn lực kiểm soát.",
            "investigator": "Là Chuyên viên điều tra gian lận, tôi muốn lọc và so sánh giao dịch theo số tiền, sản phẩm, identity/device và dữ liệu thiếu để ưu tiên hồ sơ cần kiểm tra.",
        },
        "overall": overall,
        "manager": manager_payload(df),
        "investigator": investigator_payload(df),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {output} ({output.stat().st_size / 1024:.1f} KiB)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.source.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
