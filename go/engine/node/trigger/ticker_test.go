package trigger

import (
	"context"
	"testing"
	"time"

	"github.com/ForestHubAI/fh-core/go/engine"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTicker_Lifecycle(t *testing.T) {
	t.Run("Wait fires on tick", func(t *testing.T) {
		tk := NewTicker("tick", 5*time.Millisecond)
		require.NoError(t, tk.AddTransition("", engine.Transition{TargetID: "next"}))
		require.NoError(t, tk.Setup(context.Background()))
		t.Cleanup(func() { _ = tk.Close() })

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()

		ev, err := tk.Wait(ctx)
		require.NoError(t, err)
		assert.Equal(t, "next", ev.TargetState)
	})

	t.Run("Wait fires repeatedly", func(t *testing.T) {
		tk := NewTicker("tick", 5*time.Millisecond)
		require.NoError(t, tk.AddTransition("", engine.Transition{TargetID: "next"}))
		require.NoError(t, tk.Setup(context.Background()))
		t.Cleanup(func() { _ = tk.Close() })

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()

		for i := 0; i < 3; i++ {
			ev, err := tk.Wait(ctx)
			require.NoError(t, err)
			assert.Equal(t, "next", ev.TargetState)
		}
	})

	t.Run("ctx cancel returns ctx.Err before next tick", func(t *testing.T) {
		tk := NewTicker("tick", time.Hour) // long enough that we cancel first
		require.NoError(t, tk.Setup(context.Background()))
		t.Cleanup(func() { _ = tk.Close() })

		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := tk.Wait(ctx)
		require.ErrorIs(t, err, context.Canceled)
	})

	t.Run("Close before Setup is a no-op", func(t *testing.T) {
		tk := NewTicker("tick", time.Second)
		assert.NoError(t, tk.Close())
	})
}
