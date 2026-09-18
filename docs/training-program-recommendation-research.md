# Training Program Recommendation Research Notes

Date: 2026-09-15

This phase uses research only to bound the recommendation method. The system does not infer clinical prescriptions or promised outcomes.

## Sources Checked

- ACSM progression models in resistance training for healthy adults, PubMed PMID 19204579: frequency guidance by training status, including novice 2-3 days/week, intermediate 3-4, advanced 4-5. https://pubmed.ncbi.nlm.nih.gov/19204579/
- U.S. Physical Activity Guidelines summary: adults should do muscle-strengthening activities for all major muscle groups at least 2 days/week. https://odphp.health.gov/healthypeople/tools-action/browse-evidence-based-resources/physical-activity-guidelines-americans-2nd-edition
- WHO physical activity fact sheet: adults should do muscle-strengthening activities involving major muscle groups on 2 or more days/week. https://www.who.int/news-room/fact-sheets/detail/physical-activity
- ACSM public guideline page: muscle strengthening at least 2 days/week. https://www.acsm.org/education-resources/trending-topics-resources/physical-activity-guidelines
- ACSM 2026 resistance-training guideline update page: consistency and training status matter; major muscle groups at least twice weekly. https://www.acsm.org/education-resources/trending-topics-resources/resistance-training-guidelines
- Schoenfeld/Grgic resistance-training frequency literature: frequency is often a volume-distribution variable rather than a direct magic factor when volume is equated. Example PubMed/PMC records: https://pubmed.ncbi.nlm.nih.gov/30558493/ and https://pmc.ncbi.nlm.nih.gov/articles/PMC8449772/

## Design Implications

- Frequency and experience level are legitimate gating dimensions.
- Equipment availability and contraindications are safety/feasibility hard filters, not soft LLM preferences.
- Session duration is an adherence/feasibility heuristic. It is not an effect-size estimate.
- Without program-template outcome cohorts, the recommender must not say "this plan will work" or "users like you succeeded with this plan".
- LLM can help select which grounded facts to explain, but cannot rank templates or author factual claims.

