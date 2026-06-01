# Go Test Style Guide

This document describes the testing conventions used throughout the codebase.

## 1. Test Structure — Subtests with `t.Run()`

Tests for the same function are grouped under one `TestFunction` with separate `t.Run()` subtests.
Each subtest creates its own mocks and test data for isolation.

```go
func TestClient_Health(t *testing.T) {
    t.Run("all healthy", func(t *testing.T) {
        p1 := newTestProvider(t, "providerA")
        p1.EXPECT().Health(mock.Anything).Return(nil)
        c := NewMockClient([]provider{p1})
        err := c.Health(context.Background())
        assert.NoError(t, err)
    })

    t.Run("one unhealthy", func(t *testing.T) {
        p1 := newTestProvider(t, "providerA")
        p1.EXPECT().Health(mock.Anything).Return(fmt.Errorf("unhealthy"))
        c := NewMockClient([]provider{p1})
        err := c.Health(context.Background())
        assert.Error(t, err)
    })
}
```

## 2. Naming Conventions

| Element          | Convention                                    | Examples                                                        |
|------------------|-----------------------------------------------|-----------------------------------------------------------------|
| Test function    | `TestFunctionName` or `TestStruct_Method`     | `TestClient_Health`, `TestSendVerification`, `TestToolUse`      |
| Subtest name     | Short, lowercase, descriptive                 | `"ok"`, `"success"`, `"failure"`, `"all healthy"`, `"no matching provider"` |
| Test constants   | `camelCase` package-level consts              | `testFrom`, `testUser`, `testPass`                              |

## 3. Assertions — Testify

Use `assert.*` for non-fatal assertions (test continues) and `require.*` for fatal assertions (test stops immediately). Use `require` for setup and preconditions.

```go
assert.NoError(t, err)
assert.Error(t, err)
assert.Equal(t, expected, actual)
assert.NotNil(t, res)
assert.Nil(t, res)
assert.Len(t, result, 3)
assert.Contains(t, str, "substring")
assert.True(t, condition, "message")

// require stops the test immediately — use for setup
require.NoError(t, err)
```

## 4. Mocking — Mockery

Mocks are auto-generated via Mockery (configured in `.mockery.yaml`). **Use generated mocks wherever possible**; only hand-roll a test double when it is genuinely a better fit — e.g. timing-driven loop tests where you need to assert a lower bound on call count, which mockery's exact-count expectations can't express. When you add an interface that tests will mock, list its package in `.mockery.yaml` and regenerate rather than hand-writing the mock.

### Generating Mocks

1. Ensure the package containing the interfaces is listed in `.mockery.yaml` under `packages:`.
2. Run `go tool mockery` from the repo root (or `go generate ./...`).
3. Mockery generates a single `mocks_test.go` file **inside** the package being tested (not in a `mocks/` subdirectory). For example, interfaces in `internal/service/port.go` produce `internal/service/mocks_test.go`.
4. Generated constructors follow the pattern `newMock<interfaceName>(t)` for unexported interfaces (e.g., `newMockdeviceRepository(t)`) and `NewMock<InterfaceName>(t)` for exported ones.
5. Re-run mockery whenever you add or change an interface — the generated file is fully replaced each time.

### Setting Expectations

Use the fluent `.EXPECT()` API:

```go
client.EXPECT().Chat(context.Background(), req).Return(&core.ChatResponse{
    Text: "answer",
}, nil)

// For flexible argument matching:
p1.EXPECT().Health(mock.Anything).Return(nil)

// For controlling call count:
client.EXPECT().Chat(ctx, req).Return(resp, nil).Once()
p1.EXPECT().SupportsModel(mock.Anything, modelID).Return(false, nil).Maybe()
```

### Test Helpers

Each package defines helpers to wire mocks into real structs for testing:

```go
func NewMockClient(providers []provider) *Client {
    mockProviders := make(map[core.ProviderID]provider)
    for _, p := range providers {
        mockProviders[p.ProviderID()] = p
    }
    return &Client{providers: mockProviders}
}

func NewTestRunner(llmClient llmClient, model core.ModelID, opts ...RunnerOption) *Runner {
    r := &Runner{llmClient: llmClient, DefaultModel: model}
    for _, opt := range opts {
        opt(r)
    }
    return r
}
```

## 5. Integration Tests

Integration tests use environment variable gating with `t.Skip`:

```go
func TestConnect_Integration(t *testing.T) {
    dbURL := os.Getenv("TEST_DATABASE_URL")
    if dbURL == "" {
        t.Skip("TEST_DATABASE_URL not set, skipping integration test")
    }
    // ...
}
```

Run them by setting the required env var:

```bash
TEST_DATABASE_URL="postgres://user:pass@localhost:5432/fh_test?sslmode=disable" go test ./internal/database/...
```

## 6. Error Testing

Always test both success and error paths:

```go
t.Run("success", func(t *testing.T) {
    // setup mocks to return valid data
    result, err := c.AvailableModels(context.Background())
    assert.NoError(t, err)
    assert.Len(t, result, 3)
})

t.Run("failure", func(t *testing.T) {
    // setup mocks to return an error
    _, err := c.AvailableModels(context.Background())
    assert.Error(t, err)
    assert.Contains(t, err.Error(), "providerB")
})
```

## 7. Utilities

- `pointer.Ptr()` for pointer fields (`github.com/ForestHubAI/edge-agents/go/util/pointer`)
- `t.Helper()` in test helper functions
- `t.Fatal()` for unrecoverable test failures (e.g., timeouts)
