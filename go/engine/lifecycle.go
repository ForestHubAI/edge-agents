package engine

import (
	"context"
	"time"

	"github.com/ForestHubAI/edge-agents/go/logging"
)

// RegisterWithRetry calls lc.Register until success or ctx cancellation.
// Each attempt runs under its own cfg.AttemptTimeout.
func RegisterWithRetry(ctx context.Context, lc Supervisor, reg AgentRegistration, cfg RetryConfig) {
	attempt := 0
	for {
		attempt++
		attemptCtx, cancel := context.WithTimeout(ctx, cfg.AttemptTimeout)
		err := lc.Register(attemptCtx, reg)
		cancel()
		if err == nil {
			logging.Logger.Info().Int("attempt", attempt).Str("address", reg.Address).Str("status", string(reg.Status)).Msg("agent registered")
			return
		}
		logging.Logger.Warn().Err(err).Int("attempt", attempt).Msg("register failed; retrying")

		select {
		case <-ctx.Done():
			return
		case <-time.After(cfg.Interval):
		}
	}
}

// HeartbeatLoop ticks cfg.Interval and posts one heartbeat per tick.
// Returns when ctx is canceled; failed ticks log at warn and continue.
func HeartbeatLoop(ctx context.Context, lc Supervisor, address string, cfg RetryConfig) {
	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()

	logging.Logger.Info().Dur("interval", cfg.Interval).Str("address", address).Msg("heartbeat loop started")
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			attemptCtx, cancel := context.WithTimeout(ctx, cfg.AttemptTimeout)
			err := lc.Heartbeat(attemptCtx, address)
			cancel()
			if err != nil {
				logging.Logger.Warn().Err(err).Msg("heartbeat failed")
			}
		}
	}
}
