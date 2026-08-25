# Example Company ERP — User Friendly Demo

เวอร์ชันนี้ยึดชุดไฟล์ต้นฉบับล่าสุดของผู้ใช้เป็นฐาน

## Demo Identity
- เบอร์โทรบริษัท: `000-000-0000`
- เลขประจำตัวผู้เสียภาษี: `0000000000000` (13 หลัก)
- ข้อมูลดังกล่าวตั้งใจใช้เป็นข้อมูลตัวอย่างและไม่ควรแทนข้อมูลจริง

## UI Improvements
- เพิ่มแถบลำดับขั้นตอนในฟอร์มเอกสารหลัก
- เพิ่มขนาดช่องกรอกและ Focus state ให้ชัดเจน
- ปรับตัวเลือกสาขา ตารางสินค้า ช่องแนบหลักฐาน และส่วนเชื่อมข้อมูลให้อ่านง่าย
- ทำแถบปุ่มบันทึก/ตัวอย่างให้อยู่ใกล้มือบน Desktop และเรียงแนวตั้งบน Mobile
- ไม่เปลี่ยน Business Logic, Firebase schema, VAT, Workflow และ PDF logic เดิม

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

- ปรับการแสดงวันที่/ปีบนหน้าเว็บและเอกสารให้แสดง พ.ศ. เท่านั้น โดยยังเก็บปี ค.ศ. ภายในระบบสำหรับ JavaScript/Firebase

## Dashboard / Business Analytics / Forecast Upgrade

เวอร์ชันนี้ปรับ Dashboard และ Business Analytics ให้ใช้สำหรับการเปรียบเทียบและตัดสินใจได้ง่ายขึ้น โดยเพิ่ม:

- Executive comparison cards: Sales, Delivery, Collection, Net Profit พร้อม MoM / YoY
- ตารางเปรียบเทียบรายเดือน พร้อม Delivery Rate, Collection Rate, Net Margin และสถานะที่ควรติดตาม
- ตาราง Business Analytics แบบ sticky header/first column และแสดง MoM / YoY
- Forecast 6 เดือน พร้อมช่วงต่ำ–สูงโดยประมาณ
- ตาราง Model Accuracy แสดง RMSE, MAE, sMAPE และจำนวนรอบ Rolling-origin Cross-validation
- แยก Statistical Base Forecast ออกจาก Quotation Pipeline Scenario เพื่อไม่ผสมยอดที่ยังไม่เกิดจริงเข้ากับโมเดลสถิติ

### Forecast methodology

โหมด Auto จะเปรียบเทียบโมเดลที่มีข้อมูลเพียงพอ แล้วเลือกโมเดลที่มี RMSE ต่ำสุดจาก Rolling-origin time-series cross-validation:

1. Moving Average 3 เดือน
2. Simple Exponential Smoothing (SES)
3. Holt Trend แบบ Damped
4. Holt-Winters Additive สำหรับข้อมูลรายเดือนที่มีฤดูกาล (ต้องมีอย่างน้อย 24 เดือนสำหรับ fit; Auto-CV ต้องมีอย่างน้อย 25 เดือน)
5. Linear Regression ใช้เป็น benchmark

โมเดล Exponential Smoothing จะปรับ smoothing parameters จากข้อมูลแทนการ fix ค่าคงที่เดียว และ Holt-Winters ใช้ season length = 12 สำหรับข้อมูลรายเดือน

ช่วง Forecast ต่ำ/สูงที่แสดงเป็นช่วงประมาณ 80% โดยอิง RMSE จาก cross-validation (`forecast ± 1.28 × RMSE × sqrt(horizon)`) เพื่อสื่อความไม่แน่นอนแบบอ่านง่ายใน Dashboard; ไม่ใช่ prediction interval เชิงสถิติเต็มรูปแบบของ ETS

### References

- Tableau — Forecasting / exponential smoothing: https://help.tableau.com/current/pro/desktop/en-us/forecast_how_it_works.htm
- Oracle Demand Planning — Forecast Methods: https://docs.oracle.com/cd/E18727-01/doc.121/e13634/T295435T293788.htm
- Oracle Demand Planning Cloud — Forecasting Methods: https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/faspf/forecasting-methods-for-demand-plans.html
- Forecasting: Principles and Practice — Time-series cross-validation: https://otexts.com/fpp3/tscv.html
- Forecasting: Principles and Practice — Holt trend: https://otexts.com/fpp3/holt.html
- Forecasting: Principles and Practice — Holt-Winters seasonality: https://otexts.com/fpp3/holt-winters.html


## Quant Business Intelligence Upgrade

รุ่นนี้เพิ่ม Quant Layer เพื่อช่วยตัดสินใจโดยไม่เปลี่ยนฐานข้อมูลธุรกิจเดิม:

- Forecast model selection: Rolling-origin cross-validation + RMSE / MAE / sMAPE / MASE
- Forecast uncertainty: P10 / P50 / P90 (80% normal approximation using CV RMSE as empirical error scale)
- Monte Carlo: 5,000 deterministic simulations for next-month target probability
- Revenue risk: sample Coefficient of Variation (CV) และ Peak-to-Trough decline
- Concentration: Customer/Product HHI และ Top-5 revenue share
- Robust anomaly detection: Modified Z-score based on Median Absolute Deviation (MAD), threshold |M| > 3.5
- Quote pipeline: historical approval proxy with add-one smoothing when there are at least 5 historical quotations; otherwise the legacy 35% fallback is shown explicitly
- Stress Test: Sales / Cost / Pipeline conversion shocks
- Business Regime: transparent heuristic from 3-month momentum + short-term slope (ไม่ใช่ hidden ML)

### Method references

- Hyndman & Athanasopoulos, *Forecasting: Principles and Practice (3rd ed.)*: time-series cross-validation, forecast accuracy, prediction intervals, exponential smoothing.
- NIST/SEMATECH e-Handbook: Coefficient of Variation and Median Absolute Deviation / Modified Z-score for robust outlier detection.
- U.S. DOJ Antitrust Division: HHI definition and 1,000/1,800 concentration reference thresholds. In this ERP they are used only as a **customer/product concentration proxy**, not as an antitrust/legal conclusion.

Quant outputs are decision-support estimates, not guarantees. Probability results depend on data quality, history length, and model assumptions.

### Reference URLs

- Forecasting: Principles and Practice — Time-series cross-validation: https://otexts.com/fpp3/tscv.html
- Forecasting accuracy (RMSE, MAE, MASE): https://otexts.com/fpp3/accuracy.html
- Forecast distributions and prediction intervals: https://otexts.com/fpp3/prediction-intervals.html
- Exponential smoothing / ETS: https://otexts.com/fpp3/expsmooth.html
- NIST Coefficient of Variation: https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/coefvari.htm
- NIST Median Absolute Deviation: https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/mad.htm
- NIST outlier detection / Modified Z-score: https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm
- U.S. DOJ HHI definition: https://www.justice.gov/atr/herfindahl-hirschman-index

## Workflow Center UI Fix

- แก้ปัญหา `ใบเสร็จรับเงิน` ตกลงไปบรรทัดล่างในศูนย์เชื่อมโยงเอกสาร
- Workflow บน Desktop ใช้ 11 grid tracks ให้ตรงกับ 6 ขั้นตอน + 5 ตัวเชื่อม
- หน้าจอขนาดเล็กใช้ horizontal timeline/scroll แทนการ wrap แบบไม่เป็นระเบียบ
- ปรับ card, connector, spacing และ hover ให้ลำดับเอกสารอ่านง่ายขึ้น
- ตัวเลือกปีในศูนย์เชื่อมโยงเอกสารแสดงเฉพาะ `พ.ศ.` เช่น `พ.ศ. 2569`

## Expense Evidence UX Update

ปรับหน้า **บันทึกค่าใช้จ่ายองค์กร** ให้เหมาะกับการใช้งานหน้างานและบนมือถือมากขึ้น:

- สลับลำดับตัวเลือกสาขาให้ **สาขาสำนักงานใหญ่** แสดงก่อน **สาขาที่ 00001** โดยไม่เปลี่ยน internal key (`ubon` และ `khonkaen`) เพื่อไม่กระทบ Firebase/ข้อมูลเดิม
- เพิ่มปุ่ม **ถ่ายรูปหลักฐาน** ด้วยกล้องหลังของมือถือ (`capture="environment"`)
- ยังคงรองรับการเลือกหลายรูป, PDF, Drag & Drop และ Clipboard Paste
- เพิ่มหมวดค่าใช้จ่ายที่ใช้งานจริง เช่น ค่าน้ำมัน, ซื้อสินค้า/วัสดุบริษัท, ขนส่ง, เดินทาง, สำนักงาน, ซ่อมบำรุง และอื่น ๆ
- เพิ่มข้อมูลร้านค้า/ผู้ขาย, ประเภทเอกสาร, เลขที่เอกสาร, สถานะใบกำกับภาษี และวัตถุประสงค์ค่าใช้จ่าย
- รูปที่กำลังแนบจะแสดงพร้อมหมวดค่าใช้จ่ายและสถานะเอกสาร ทำให้รู้ว่ารูปนั้นเป็นหลักฐานของอะไร
- หน้า **รายการค่าใช้จ่ายองค์กร** เพิ่มคอลัมน์เอกสารภาษี/หลักฐาน และปุ่มดูรายละเอียดพร้อมไฟล์แนบ
- ข้อมูลใหม่ถูกบันทึกเป็น field เพิ่มเติมใน expense record จึงไม่เปลี่ยนสูตร Dashboard หรือโครงสร้างเอกสารเดิม

ตัวอย่าง record ใหม่:

```js
{
  cat: "ค่าน้ำมันเชื้อเพลิง",
  vendor: "สถานีบริการตัวอย่าง",
  desc: "เติมน้ำมันรถบริษัท",
  amount: 1500,
  docType: "receipt_tax_invoice",
  taxStatus: "requested",
  docNo: "",
  purpose: "company",
  attachments: []
}
```
