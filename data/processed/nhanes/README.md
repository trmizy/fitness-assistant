# NHANES Body Composition Data

## Source
National Health and Nutrition Examination Survey (CDC NHANES)
https://www.cdc.gov/nchs/nhanes/

## Files
| File | Survey | Description |
|------|--------|-------------|
| BMX_L.csv | 2021-23 | Body measurements (weight, height, BMI, waist) |
| BMX_J.csv | 2017-18 | Body measurements |
| DXX_J.csv | 2017-18 | DXA total body composition (lean, fat mass, BF%) |
| DXXAG_J.csv | 2017-18 | DXA android/gynoid fat distribution |
| DEMO_J.csv | 2017-18 | Demographics (age, gender, race) |
| merged_2017.jsonl | 2017-18 | Joined BMX + DXA + DEMO by SEQN |

## Key Columns
- `weight_kg` / `height_cm` / `bmi` — anthropometric measurements
- `lean_mass_kg` / `fat_mass_kg` / `body_fat_pct` — DXA body composition
- `age_years` / `gender` (M/F) — demographics
- `android_fat_kg` / `gynoid_fat_kg` — regional fat distribution

## Usage Constraints
⚠️ **This data is for ANALYTICS / NORMATIVE REFERENCE ONLY.**
- Do NOT use as authoritative nutrition or medical advice.
- Population norms differ by age, sex, race, and health status.
- NHANES is designed for statistical analysis of US populations, not individual diagnosis.
- Public domain (US Government work).

## Citation
CDC NHANES. (2021). National Health and Nutrition Examination Survey Data.
Hyattsville, MD: U.S. Department of Health and Human Services, CDC.
https://www.cdc.gov/nchs/nhanes/
