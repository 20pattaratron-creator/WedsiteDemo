#!/usr/bin/env python3
"""Independent reference for erp-forecast-core.js (ADR-027).

Re-implements the same recursions, initial states, grids, holdout rule and safety rails with numpy
(written from the ADR text, not translated line by line from the JavaScript), and prints the figures that
tests/forecast-core.test.cjs pins. Run:  python3 -I scripts/forecast-reference.py
Not part of the app or of `npm run verify`; the printed numbers are copied into the test with their source.
"""
import json
import math

import numpy as np

SES_ALPHAS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
HOLT_BETAS = [0.05, 0.1, 0.2, 0.3]
HW_BETAS = [0.05, 0.1, 0.2]
HW_GAMMAS = [0.05, 0.1, 0.3]
M = 12
Z80 = 1.2816


def ses(y, a):
    y = np.asarray(y, dtype=float)
    level = y[0]
    res = []
    for t in range(1, len(y)):
        e = y[t] - level
        res.append(e)
        level = level + a * e
    return {"method": "ses", "level": level, "trend": 0.0, "season": None, "n": len(y), "res": np.array(res), "params": [a]}


def holt(y, a, b):
    y = np.asarray(y, dtype=float)
    level, trend = y[1], y[1] - y[0]
    res = []
    for t in range(2, len(y)):
        pred = level + trend
        e = y[t] - pred
        res.append(e)
        new_level = a * y[t] + (1 - a) * pred
        trend = b * (new_level - level) + (1 - b) * trend
        level = new_level
    return {"method": "holt", "level": level, "trend": trend, "season": None, "n": len(y), "res": np.array(res), "params": [a, b]}


def hw(y, a, b, g):
    y = np.asarray(y, dtype=float)
    first, second = y[:M].mean(), y[M:2 * M].mean()
    trend = (second - first) / M
    centre = (M - 1) / 2
    level = first + trend * centre
    season = [y[j] - (first + trend * (j - centre)) for j in range(M)]
    res = []
    for t in range(M, len(y)):
        s = season[t % M]
        pred = level + trend + s
        e = y[t] - pred
        res.append(e)
        new_level = a * (y[t] - s) + (1 - a) * (level + trend)
        trend = b * (new_level - level) + (1 - b) * trend
        season[t % M] = g * (y[t] - new_level) + (1 - g) * s
        level = new_level
    return {"method": "hw", "level": level, "trend": trend, "season": season, "n": len(y), "res": np.array(res), "params": [a, b, g]}


def sse(fit):
    return float(np.sum(fit["res"] ** 2))


def best(method, y):
    fits = []
    if method == "ses":
        fits = [ses(y, a) for a in SES_ALPHAS]
    elif method == "holt":
        fits = [holt(y, a, b) for a in SES_ALPHAS for b in HOLT_BETAS]
    else:
        fits = [hw(y, a, b, g) for a in SES_ALPHAS for b in HW_BETAS for g in HW_GAMMAS]
    winner = None
    for f in fits:
        if winner is None or sse(f) < sse(winner):
            winner = f
    return winner


def point(fit, h):
    if fit["method"] == "ses":
        return fit["level"]
    if fit["method"] == "holt":
        return fit["level"] + h * fit["trend"]
    return fit["level"] + h * fit["trend"] + fit["season"][(fit["n"] - 1 + h) % M]


def cap_of(y):
    mx = max(y)
    return 3 * mx if mx > 0 else 0.0


def guard(raw, cap):
    return 0.0 if raw < 0 else (cap if raw > cap else raw)


def sigma_of(res):
    return math.sqrt(float(np.mean(res ** 2))) if len(res) >= 3 else None


def holdout_len(n):
    if n >= 27:
        return min(6, n - 24)
    return min(6, max(3, n // 4))


def err(metric, act, fc):
    act, fc = np.asarray(act, float), np.asarray(fc, float)
    if metric == "mape":
        return float(np.mean(np.abs(act - fc) / np.abs(act)) * 100)
    den = np.abs(act) + np.abs(fc)
    terms = np.where(den > 0, 2 * np.abs(act - fc) / np.where(den > 0, den, 1), 0.0)
    return float(np.mean(terms) * 100)


def candidate(method, y, h, metric):
    train, act = y[:-h], y[-h:]
    need = {"ses": 2, "holt": 3, "hw": 24}[method]
    if len(train) < need:
        return None
    f = best(method, train)
    cap = cap_of(train)
    fc = [guard(point(f, k), cap) for k in range(1, h + 1)]
    return {"method": method, "params": f["params"], "forecasts": fc, "error": err(metric, act, fc)}


def forecast(y, horizon=3):
    y = [float(v) for v in y]
    n = len(y)
    h = holdout_len(n)
    metric = "smape" if any(v <= 0 for v in y[-h:]) else "mape"
    c_holt, c_ses = candidate("holt", y, h, metric), candidate("ses", y, h, metric)
    chosen = c_ses if c_ses["error"] < c_holt["error"] else c_holt
    c_hw = candidate("hw", y, h, metric) if n >= 27 else None
    if c_hw is not None and c_hw["error"] < chosen["error"]:
        chosen = c_hw
    f = best(chosen["method"], y)
    cap = cap_of(y)
    sig = sigma_of(f["res"])
    rows = []
    for k in range(1, horizon + 1):
        p = guard(point(f, k), cap)
        half = Z80 * sig * math.sqrt(k)
        rows.append({"h": k, "value": p, "lower": min(cap, max(0.0, p - half)), "upper": min(cap, max(0.0, p + half))})
    return {"n": n, "holdout": h, "metric": metric, "method": f["method"], "params": f["params"], "sigma": sig,
            "candidates": {c["method"]: {"error": c["error"], "params": c["params"], "forecasts": c["forecasts"]} for c in [c_holt, c_ses, c_hw] if c},
            "forecast": rows}


def seasonal_series():
    # 36 months: level 100, trend +2 / month, a fixed seasonal pattern, a small deterministic wiggle.
    pattern = [-10, -8, -2, -25, -12, 0, 2, 4, 10, 12, 20, 9]
    return [100 + 2 * t + pattern[t % 12] + ((t * 7) % 5 - 2) for t in range(36)]


def main():
    out = {}
    out["ses_hand"] = {k: v for k, v in ses([10, 12, 11, 13, 12], 0.5).items() if k in ("level",)}
    out["ses_hand"]["res"] = ses([10, 12, 11, 13, 12], 0.5)["res"].tolist()
    h = holt([10, 12, 15, 14, 18, 20], 0.5, 0.2)
    out["holt_hand"] = {"level": h["level"], "trend": h["trend"], "res": h["res"].tolist(), "sse": sse(h)}
    s = seasonal_series()
    w = hw(s, 0.3, 0.1, 0.1)
    out["hw_fixed"] = {"level": w["level"], "trend": w["trend"], "season": w["season"], "sse": sse(w),
                       "next3": [point(w, k) for k in (1, 2, 3)]}
    out["hw_series"] = s
    out["forecast_seasonal36"] = forecast(s, 6)
    out["forecast_trend8"] = forecast([20, 22, 25, 24, 28, 30, 31, 35], 3)
    out["forecast_flat_noise12"] = forecast([50, 52, 48, 51, 49, 50, 53, 47, 50, 51, 49, 50], 3)
    out["forecast_zeros10"] = forecast([5, 0, 3, 0, 4, 6, 0, 2, 5, 0], 3)
    print(json.dumps(out, indent=1, default=float))


if __name__ == "__main__":
    main()
