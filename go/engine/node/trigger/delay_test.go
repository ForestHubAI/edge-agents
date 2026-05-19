package trigger

import (
	"context"
	"testing"
	"time"

	"github.com/ForestHubAI/fh-core/go/engine"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDelay_Lifecycle(t *testing.T) {
	t.Run("Wait fires once after the configured duration", func(t *testing.T) {
		d := NewDelay("d", 5*time.Millisecond)
		require.NoError(t, d.AddTransition("", engine.Transition{TargetID: "next"}))
		require.NoError(t, d.Setup(context.Background()))
		t.Cleanup(func() { _ = d.Close() })

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		ev, err := d.Wait(ctx)
		require.NoError(t, err)
		assert.Equal(t, "next", ev.TargetState)
	})

	t.Run("subsequent Wait blocks until ctx cancels", func(t *testing.T) {
		d := NewDelay("d", 5*time.Millisecond)
		require.NoError(t, d.AddTransition("", engine.Transition{TargetID: "next"}))
		require.NoError(t, d.Setup(context.Background()))
		t.Cleanup(func() { _ = d.Close() })

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_, err := d.Wait(ctx) // first fire
		require.NoError(t, err)

		// Second Wait should block on ctx; cancel and assert.
		ctx2, cancel2 := context.WithCancel(context.Background())
		errCh := make(chan error, 1)
		go func() {
			_, err := d.Wait(ctx2)
			errCh <- err
		}()
		// Brief sleep to let the goroutine enter Wait, then cancel.
		time.Sleep(20 * time.Millisecond)
		cancel2()

		select {
		case err := <-errCh:
			require.ErrorIs(t, err, context.Canceled)
		case <-time.After(time.Second):
			t.Fatal("Wait did not return after ctx cancel")
		}
	})

	t.Run("ctx cancel before fire returns ctx.Err", func(t *testing.T) {
		d := NewDelay("d", time.Hour)
		require.NoError(t, d.Setup(context.Background()))
		t.Cleanup(func() { _ = d.Close() })

		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := d.Wait(ctx)
		require.ErrorIs(t, err, context.Canceled)
	})

	t.Run("Close before Setup is a no-op", func(t *testing.T) {
		d := NewDelay("d", time.Second)
		assert.NoError(t, d.Close())
	})
}
