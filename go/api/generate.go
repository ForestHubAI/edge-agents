// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package api

//go:generate go tool oapi-codegen -old-config-style -generate types,skip-prune 																							-o llmapi/types.gen.go -package llmapi ../../contract/llmproxy.yaml
//go:generate go tool oapi-codegen -old-config-style -generate types,skip-prune 		-import-mapping llmproxy.yaml:github.com/ForestHubAI/edge-agents/go/api/llmapi		-o workflowapi/types.gen.go -package workflowapi ../../contract/workflow.yaml
//go:generate go tool oapi-codegen -old-config-style -generate types,skip-prune       	-import-mapping workflow.yaml:github.com/ForestHubAI/edge-agents/go/api/workflowapi	-o engineapi/types.gen.go  -package engineapi ../../contract/engine.yaml
//go:generate go tool oapi-codegen -old-config-style -generate chi-server,strict-server	-import-mapping workflow.yaml:github.com/ForestHubAI/edge-agents/go/api/workflowapi 	-o engineapi/server.gen.go -package engineapi ../../contract/engine.yaml
//go:generate go tool oapi-codegen -old-config-style -generate types,skip-prune       	-import-mapping workflow.yaml:github.com/ForestHubAI/edge-agents/go/api/workflowapi 	-o debugapi/types.gen.go   -package debugapi ../../contract/debug.yaml
//go:generate go tool oapi-codegen -old-config-style -generate types,skip-prune       	-import-mapping workflow.yaml:github.com/ForestHubAI/edge-agents/go/api/workflowapi 	-o deployapi/types.gen.go  -package deployapi ../../contract/deployment.yaml
//go:generate go tool oapi-codegen -old-config-style -generate client,types,skip-prune -o mlinferenceapi/client.gen.go -package mlinferenceapi ../../contract/mlinference.yaml
//go:generate go tool oapi-codegen -old-config-style -generate client,types,std-http-server,skip-prune -o captureapi/captureapi.gen.go -package captureapi ../../contract/capture.yaml
