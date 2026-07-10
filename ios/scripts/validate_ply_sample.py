#!/usr/bin/env python3
"""Smoke-test the sample PLY against the same decode rules as SplatCore."""

from __future__ import annotations

import math
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SAMPLE = ROOT / "samples" / "sample.ply"
SH_C0 = 0.28209479177387814


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def main() -> int:
    data = SAMPLE.read_bytes()
    end = data.find(b"end_header\n")
    if end < 0:
        print("missing end_header", file=sys.stderr)
        return 1
    body = end + len(b"end_header\n")
    header = data[:body].decode("ascii")
    props = [line.split()[-1] for line in header.splitlines() if line.startswith("property float")]
    count = int([line for line in header.splitlines() if line.startswith("element vertex")][0].split()[-1])
    stride = len(props) * 4
    assert len(data) - body == count * stride, "body size mismatch"
    required = {"x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"}
    assert required.issubset(props), f"missing props: {required - set(props)}"
    idx = {name: i for i, name in enumerate(props)}
    first = struct.unpack("<" + "f" * len(props), data[body : body + stride])
    color = [max(0.0, min(1.0, 0.5 + SH_C0 * first[idx[k]])) for k in ("f_dc_0", "f_dc_1", "f_dc_2")]
    opacity = sigmoid(first[idx["opacity"]])
    scale = [math.exp(first[idx[k]]) for k in ("scale_0", "scale_1", "scale_2")]
    assert 0.0 < opacity <= 1.0
    assert all(s > 0 for s in scale)
    assert all(0.0 <= c <= 1.0 for c in color)
    print(f"OK  vertices={count}  first_opacity={opacity:.4f}  color={color}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
