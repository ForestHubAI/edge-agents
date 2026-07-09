// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package llmproxy

// RetryWithResilienceContext retries the given operation according to the provided resilience configuration.
// func RetryWithResilienceContext(ctx context.Context, cfg config.ResilienceConfig, operation func(ctx context.Context) error) error {
// 	var err error
// 	delay := cfg.InitialDelay

// 	for i := 0; i < cfg.MaxRetries; i++ {
// 		err = operation(ctx)
// 		if err == nil {
// 			return nil
// 		}

// 		if cfg.Jitter {
// 			delay = time.Duration(float64(delay) * (1 + rand.Float64()*0.5))
// 		}

// 		time.Sleep(delay)
// 		delay = min(time.Duration(float64(delay)*cfg.Multiplier), cfg.MaxDelay)
// 	}

// 	return err
// }
