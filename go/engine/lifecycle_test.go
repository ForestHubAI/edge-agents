package engine

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// stubLifecycle is a hand-rolled Lifecycle for exercising the loop
// helpers without HTTP. registerErrs and heartbeatErrs are popped in
// order; once exhausted, subsequent calls succeed.
type stubLifecycle struct {
	mu             sync.Mutex
	registerCalls  atomic.Int32
	heartbeatCalls atomic.Int32
	registerErrs   []error
	heartbeatErrs  []error
}

func (s *stubLifecycle) Register(_ context.Context, _ AgentRegistration) error {
	s.registerCalls.Add(1)
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.registerErrs) == 0 {
		return nil
	}
	err := s.registerErrs[0]
	s.registerErrs = s.registerErrs[1:]
	return err
}

func (s *stubLifecycle) Heartbeat(_ context.Context, _ string) error {
	s.heartbeatCalls.Add(1)
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.heartbeatErrs) == 0 {
		return nil
	}
	err := s.heartbeatErrs[0]
	s.heartbeatErrs = s.heartbeatErrs[1:]
	return err
}

func TestRegisterWithRetry_EventuallySucceeds(t *testing.T) {
	stub := &stubLifecycle{
		registerErrs: []error{errors.New("first"), errors.New("second")},
	}
	cfg := RetryConfig{AttemptTimeout: 50 * time.Millisecond, Interval: 20 * time.Millisecond}

	done := make(chan struct{})
	go func() {
		RegisterWithRetry(context.Background(), stub, AgentRegistration{Address: "x", Status: StatusOnline}, cfg)
		close(done)
	}()

	select {
	case <-done:
		assert.GreaterOrEqual(t, stub.registerCalls.Load(), int32(3))
	case <-time.After(2 * time.Second):
		t.Fatal("RegisterWithRetry did not return within 2s")
	}
}

func TestRegisterWithRetry_RespectsContextCancel(t *testing.T) {
	stub := &stubLifecycle{}
	for range 100 {
		stub.registerErrs = append(stub.registerErrs, errors.New("never succeeds"))
	}
	cfg := RetryConfig{AttemptTimeout: 50 * time.Millisecond, Interval: 20 * time.Millisecond}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		RegisterWithRetry(ctx, stub, AgentRegistration{Status: StatusOnline}, cfg)
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
	stub := &stubLifecycle{}
	cfg := RetryConfig{AttemptTimeout: 50 * time.Millisecond, Interval: 20 * time.Millisecond}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		HeartbeatLoop(ctx, stub, "http://engine:8081", cfg)
		close(done)
	}()

	time.Sleep(80 * time.Millisecond)
	cancel()

	select {
	case <-done:
		assert.GreaterOrEqual(t, stub.heartbeatCalls.Load(), int32(2))
	case <-time.After(2 * time.Second):
		t.Fatal("HeartbeatLoop did not exit after context cancel")
	}
}

func TestHeartbeatLoop_FailureContinues(t *testing.T) {
	stub := &stubLifecycle{
		heartbeatErrs: []error{errors.New("first"), errors.New("second")},
	}
	cfg := RetryConfig{AttemptTimeout: 50 * time.Millisecond, Interval: 20 * time.Millisecond}

	ctx, cancel := context.WithCancel(context.Background())
	go HeartbeatLoop(ctx, stub, "http://engine:8081", cfg)

	time.Sleep(120 * time.Millisecond)
	cancel()

	assert.GreaterOrEqual(t, stub.heartbeatCalls.Load(), int32(4))
}
