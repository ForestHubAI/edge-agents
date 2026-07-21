// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package resource

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPahoTransport_SubscribeRejectsDuplicateFilter(t *testing.T) {
	// Two MQTT channels on one (ref, topic) both subscribe the same filter. paho
	// would overwrite the route and silently unhook the first; the transport
	// refuses the second instead. The reject path returns before touching the
	// client, so no broker is needed here.
	tr := &pahoTransport{claimed: map[string]bool{"alarm": true}}

	err := tr.Subscribe("alarm", 0, func(MQTTMessage) {})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "already subscribed")
}
