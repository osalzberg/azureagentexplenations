# Scoring System Improvements

## Summary
Comprehensive improvements to the multi-judge LLM evaluation system for Azure Log Analytics explanations.

## Changes Made

### 1. **Enhanced Evaluation Prompt** ✅
**Before:**
- Generic "BE STRICT" instruction
- Limited examples
- Inconsistent score interpretation

**After:**
- Clear 5-point scale definitions (5=Exceptional, 4=Good, 3=Adequate, 2=Below average, 1=Poor)
- Audience-specific calibration examples
- Detailed rubrics for each dimension with concrete criteria
- Added confidence scoring (1-5) for each judge

**Impact:** Better score calibration and consistency across judges

---

### 2. **Increased Context Limits** ✅
**Before:**
- Max explanation: 3,000 chars
- Result data: 5 rows, 800 chars

**After:**
- Max explanation: 5,000 chars (+67%)
- Result data: 10 rows, 1,200 chars (+100% rows, +50% chars)

**Impact:** More comprehensive evaluations, less truncation of important content

---

### 3. **Judge Score Normalization** ✅
**Implementation:**
```python
def normalize_judge_scores(all_judge_scores, dimensions):
    """
    Z-score normalization per judge to account for bias.
    - Calculate each judge's mean and std deviation
    - Normalize to z-scores
    - Rescale to 1-5 range
    - Clamp to valid range
    """
```

**Impact:** Accounts for judges that are naturally lenient/harsh

---

### 4. **Consensus Checking** ✅
**Added Metrics:**
- Standard deviation per dimension
- Min/Max/Range per dimension
- Flags dimensions with high disagreement (std > 1.0 or range > 2)

**Response Format:**
```json
{
  "consensus": {
    "highDisagreement": ["faithfulness", "analysisDepth"],
    "statistics": {
      "faithfulness": {
        "mean": 3.5,
        "std": 1.2,
        "min": 2,
        "max": 5,
        "range": 3
      }
    }
  },
  "averageConfidence": 4.2
}
```

**Impact:** Visibility into judge agreement, can flag unreliable evaluations

---

### 5. **Audience-Specific Weight Profiles** ✅

#### Developer (Default)
- Faithfulness: 25% (hallucinations critical)
- Analysis Depth: 20% (want insights)
- Context Accuracy: 15% (Azure knowledge matters)
- Clarity: 15%
- Structure: 10%
- Actionability: 10%
- Conciseness: 5%

#### SRE/DevOps
- **Actionability: 20%** ⬆️ (need specific steps)
- Faithfulness: 25%
- Analysis Depth: 15%
- Clarity: 12%
- Context Accuracy: 12%
- Conciseness: 8%
- Structure: 8%

#### Analyst
- **Faithfulness: 30%** ⬆️ (accuracy paramount)
- **Analysis Depth: 25%** ⬆️ (deep insights critical)
- Clarity: 18%
- Structure: 12%
- Context Accuracy: 10%
- Actionability: 5%
- Conciseness: 0% (verbosity OK for thoroughness)

#### Executive
- **Clarity: 25%** ⬆️ (must be crystal clear)
- Faithfulness: 20%
- **Structure: 15%** ⬆️ (scannable format)
- Analysis Depth: 15%
- Actionability: 15%
- Conciseness: 5%
- Context Accuracy: 5%

**API Endpoint:** `GET /api/audience-weights`

**Impact:** Scores reflect what matters most for each audience type

---

### 6. **Calibration Examples** ✅
Added audience-specific scoring examples:

**Developer Example (Faithfulness):**
- Score 5: "247 failed requests with ResultCode 500, representing 12% of total requests. Top affected endpoint is /api/users with 89 failures."
- Score 3: "Query shows several failed requests. Might indicate a server issue."
- Score 1: "High failure rate of 45% (actual: 12%) likely caused by database issues (no database in query)."

**Impact:** Judges have concrete benchmarks for scoring

---

## Technical Improvements

### Error Handling
- 3 retry attempts for each judge
- Graceful fallback if normalization fails
- Continue if some judges fail (vs. all-or-nothing)

### Logging
- Detailed console logs for debugging
- Consensus warnings logged
- Individual judge response tracking

### Response Metadata
```json
{
  "scores": {...},
  "judgeCount": 4,
  "judges": ["gpt-4", "gpt-5.2-chat", "gpt-4.1-nano", "o4-mini"],
  "averageConfidence": 4.2,
  "consensus": {...},
  "individualJudges": [...]
}
```

---

## Recommendations for Further Improvement

### High Priority
1. **Outlier Detection** - Remove/flag statistical outlier scores
2. **Judge Weighting** - Weight judges based on historical accuracy
3. **Confidence Thresholding** - Flag/retry low-confidence evaluations

### Medium Priority
4. **Few-Shot Examples** - Include 2-3 full example evaluations in prompt
5. **Dimension Dependencies** - Track correlation between dimensions
6. **Temporal Tracking** - Monitor judge consistency over time

### Low Priority
7. **Human Baseline** - Collect human ratings for validation
8. **A/B Testing** - Compare normalized vs raw scores
9. **Custom Weights UI** - Allow users to adjust weights

---

## Testing Recommendations

1. **Consistency Test:** Run same explanation 5 times, measure variance
2. **Calibration Test:** Use known good/bad examples, verify scores
3. **Consensus Test:** Check high-disagreement cases manually
4. **Audience Test:** Verify different audiences get different rankings

---

## Performance Notes

- **Judges Used:** 4 models (GPT-4, GPT-5.2, GPT-4.1 Nano, O4 Mini)
- **Evaluation Time:** ~5-10 seconds per explanation (parallel possible)
- **Token Usage:** ~800-1500 tokens per judge per evaluation
- **Cost Impact:** 4x judge calls vs. single evaluator

---

## Migration Notes

**Breaking Changes:** None - all changes are backwards compatible

**New Features Available:**
- Consensus warnings in response
- Confidence scores
- Normalized scores (automatic)
- Audience-specific weights (via API)

**Recommended Actions:**
1. Update UI to display consensus warnings
2. Show confidence scores in results
3. Add audience weight selector
4. Monitor high-disagreement cases

---

## Configuration

All weights and judge models configurable in `app.py`:

```python
# Judge models
judge_models = ["gpt-4", "gpt-5.2-chat", "gpt-4.1-nano", "o4-mini"]

# Audience weights
AUDIENCE_WEIGHTS = {
    "developer": {...},
    "sre": {...},
    "analyst": {...},
    "executive": {...}
}

# Consensus thresholds
HIGH_DISAGREEMENT_STD = 1.0
HIGH_DISAGREEMENT_RANGE = 2
```

---

## Questions Answered

✅ **Score calibration** - Added examples and clearer rubrics
✅ **Weight distribution** - Now audience-specific
✅ **Judge reliability** - Added normalization and consensus checking
✅ **Data truncation** - Increased limits significantly
✅ **Prompt quality** - Improved with calibration examples

---

## Next Steps

1. ✅ Backend improvements complete
2. ⏳ Update frontend to show new metadata
3. ⏳ Add UI controls for audience weights
4. ⏳ Implement consensus warning display
5. ⏳ Test with real queries

---

**Date:** 2026-01-20  
**Version:** 2.0  
**Status:** Ready for Testing
