package engine

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestRegisterWithRetry_EventuallySucceeds(t *testing.T) {
	sup := NewMockSupervisor(t)
	// Fail twice, then succeed. Expectations are consumed in order, and the
	// cleanup AssertExpectations verifies all three were hit.
	sup.EXPECT().Register(mock.Anything, mock.Anything).Return(assert.AnError).Times(2)
	sup.EXPECT().Register(mock.Anything, mock.Anything).Return(nil).Once()
	cfg := RetryConfig{AttemptTimeout: 50 * time.Millisecond, Interval: 20 * time.Millisecond}

	done := make(chan struct{})
	go func() {
		RegisterWithRetry(context.Background(), sup, AgentRegistration{Address: "x", Status: StatusOnline}, cfg)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("RegisterWithRetry did not return within 2s")
	}
}

func TestRegisterWithRetry_RespectsContextCancel(t *testing.T) {
	sup := NewMockSupervisor(t)
	sup.EXPECT().Register(mock.Anything, mock.Anything).Return(assert.AnError)
	cfg := RetryConfig{AttemptTimeout: 50 * time.Millisecond, Interval: 20 * time.Millisecond}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		RegisterWithRetry(ctx, sup, AgentRegistration{Status: StatusOnline}, cfg)
		close(done)
	}()

	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("RegisterWithRetry did not exit after context cancel")
	}
}

func TestHeartbeatLoop_TickAndCancel(t *testing.T) {
	sup := NewMockSupervisor(t)
	// Unbounded expectation: the loop ticks an unknown number of times. A
	// Run hook counts calls so we can assert it ticked more than once before
	// cancel — something mockery's exact-count assertions can't express for a
	// timing-driven loop.
	var calls atomic.Int32
	sup.EXPECT().Heartbeat(mock.Anything, mock.Anything).
		Run(func(context.Context, string) { calls.Add(1) }).
		Return(nil)
	cfg := RetryConfig{AttemptTimeout: 50 * time.Millisecond, Interval: 20 * time.Millisecond}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		HeartbeatLoop(ctx, sup, "http://engine:8081", cfg)
		close(done)
	}()

	time.Sleep(80 * time.Millisecond)
	cancel()

	select {
	case <-done:
		assert.GreaterOrEqual(t, calls.Load(), int32(2))
	case <-time.After(2 * time.Second):
		t.Fatal("HeartbeatLoop did not exit after context cancel")
	}
}

func TestHeartbeatLoop_FailureContinues(t *testing.T) {
	sup := NewMockSupervisor(t)
	// First two ticks fail; the loop must keep going and reach a success.
	// AssertExpectations confirms the post-failure success expectation was hit.
	sup.EXPECT().Heartbeat(mock.Anything, mock.Anything).Return(assert.AnError).Times(2)
	sup.EXPECT().Heartbeat(mock.Anything, mock.Anything).Return(nil)
	cfg := RetryConfig{AttemptTimeout: 50 * time.Millisecond, Interval: 20 * time.Millisecond}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		HeartbeatLoop(ctx, sup, "http://engine:8081", cfg)
		close(done)
	}()

	time.Sleep(120 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("HeartbeatLoop did not exit after context cancel")
	}
}
