CREATE TABLE IF NOT EXISTS public.calculation_history (
    calculation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    calculated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    browser_token_hash text NOT NULL
        CONSTRAINT calculation_history_browser_token_hash_check
        CHECK (browser_token_hash ~ '^[0-9a-f]{64}$'),
    expression text NOT NULL,
    result double precision NOT NULL
);

CREATE INDEX IF NOT EXISTS calculation_history_browser_newest_idx
    ON public.calculation_history (
        browser_token_hash,
        calculated_at DESC,
        calculation_id DESC
    );
