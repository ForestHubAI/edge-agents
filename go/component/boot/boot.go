// Package boot holds the cross-component boot-failure policy: how any ForestHub
// component reports a fatal startup outcome to the orchestrator
// through its process exit code. It composes the exit-code contract (component) with
// the fatal-exit mechanism (logging) — neither of those depends on the other, so this
// is the single place the policy lives without bloating either.
package boot

import (
	"github.com/ForestHubAI/edge-agents/go/component"
	"github.com/ForestHubAI/edge-agents/go/logging"
)

// Fail ends a PERMANENT boot failure: the config, workflow, or device manifest is
// wrong, so a restart fails identically. It exits component.ExitConfigError (78) so
// the orchestrator marks the deployment failed instead of retrying.
func Fail(cause error, msg string) {
	logging.FatalExit(component.ExitConfigError, cause, msg)
}

// Retry ends a TRANSIENT boot failure: the cause may clear on a later start (a broker
// briefly unreachable), so it exits nonzero (1) and the orchestrator may restart the
// container; the healthcheck/startup backstop catches one that never recovers.
func Retry(cause error, msg string) {
	logging.FatalExit(1, cause, msg)
}
