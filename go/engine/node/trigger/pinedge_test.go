package trigger

import (
	"context"
	"testing"
	"time"

	"github.com/ForestHubAI/fh-core/go/engine"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOnPinEdge_Matches(t *testing.T) {
	rising := &OnPinEdge{edge: EdgeRising}
	falling := &OnPinEdge{edge: EdgeFalling}
	both := &OnPinEdge{edge: EdgeBoth}

	assert.True(t, rising.matches(true))
	assert.False(t, rising.matches(false))

	assert.False(t, falling.matches(true))
	assert.True(t, falling.matches(false))

	assert.True(t, both.matches(true))
	assert.True(t, both.matches(false))
}

// newTestPinEdge constructs an OnPinEdge wired to the given event channel.
// Bypasses NewOnPinEdge to avoid needing a real channel.GPIOInput.
func newTestPinEdge(id string, edge Edge, events <-chan bool) *OnPinEdge {
	p := &OnPinEdge{
		TriggerNode: engine.NewTriggerNode(id),
		edge:        edge,
		events:      events,
	}
	return p
}

func TestOnPinEdge_Wait(t *testing.T) {
	t.Run("rising-only fires on rising and ignores falling", func(t *testing.T) {
		ch := make(chan bool, 4)
		p := newTestPinEdge("p", EdgeRising, ch)
		require.NoError(t, p.AddTransition("", engine.Transition{TargetID: "next"}))

		ch <- false // ignored
		ch <- true  // fires

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		ev, err := p.Wait(ctx)
		require.NoError(t, err)
		assert.Equal(t, "next", ev.TargetState)
	})

	t.Run("both fires on either edge", func(t *testing.T) {
		ch := make(chan bool, 1)
		p := newTestPinEdge("p", EdgeBoth, ch)
		require.NoError(t, p.AddTransition("", engine.Transition{TargetID: "next"}))

		ch <- false
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		ev, err := p.Wait(ctx)
		require.NoError(t, err)
		assert.Equal(t, "next", ev.TargetState)
	})

	t.Run("ctx cancel returns ctx.Err", func(t *testing.T) {
		ch := make(chan bool)
		p := newTestPinEdge("p", EdgeBoth, ch)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := p.Wait(ctx)
		require.ErrorIs(t, err, context.Canceled)
	})

	t.Run("closed event stream errors", func(t *testing.T) {
		ch := make(chan bool)
		close(ch)
		p := newTestPinEdge("p", EdgeBoth, ch)
		_, err := p.Wait(context.Background())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "stream closed")
	})

	t.Run("Close is a no-op", func(t *testing.T) {
		p := newTestPinEdge("p", EdgeBoth, nil)
		assert.NoError(t, p.Close())
	})
}
