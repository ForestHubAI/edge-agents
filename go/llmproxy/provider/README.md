# Provider Package Architecture

This package contains the provider-specific integrations for the LLM proxy. Each provider is implemented in its own subfolder, following a consistent structure to ensure maintainability and extensibility.

## File Structure

Within each provider folder, following files typically exist:

- `provider.go`: Implements the `Provider` interface for the specific provider, handling all communication and logic required to interact with the provider's API. May use a providers SDK, or `httpclient` to send requests.
- `provider_test.go`: Contains integration tests for the provider implementation, redirecting them to `suite.go`.
- `mapping.go`: Contains mapping logic to convert between the core LLM proxy types (from the `core` package) and the provider's domain types.
- `types.go`: Defines provider-specific domain types, such as request/response structs, enums, or helper types that are unique to the provider's API. Not necessary if the provider comes with a maintained go SDK.

## Adding a New Provider

When implementing a new provider, follow these steps:

1. **Check for a Go SDK:**
   - If the provider offers an official or community-maintained Go SDK, prefer using it directly in `provider.go` and for type definitions.

2. **Check for OpenAPI Specification:**
   - If no Go SDK is available, check if the provider publishes an OpenAPI (Swagger) YAML file. You can use this to generate Go domain types automatically with oapi-codegen into a `types.gen.go` file, reducing manual work and ensuring type safety.

3. **Manual Implementation:**
   - If neither a Go SDK nor an OpenAPI spec is available, manually implement the provider's types in a `types.go` file.

## The `testsuite` Package

The `testsuite` subfolder provides a reusable set of tests and test utilities for provider implementations. It defines a standard interface and a collection of test cases that all providers should pass to ensure consistent behavior and compatibility with the LLM proxy's expectations.