-- Final scores and realized outcomes remain intact. These were never raw model probabilities.
UPDATE public.ai_signals
SET win_prob_raw = NULL,
    win_prob_calibrated = NULL,
    direction_prob = NULL,
    direction_prob_raw = NULL,
    tp_before_sl_prob_raw = NULL,
    tp_before_sl_prob_calibrated = NULL
WHERE calibration_method = 'final_probability_snapshot';
