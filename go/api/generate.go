// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package api

//go:generate go tool oapi-codegen -package llmapi			-old-config-style -generate types,skip-prune							-o llmapi/api.gen.go																							../../contract/llmproxy.yaml
//go:generate go tool oapi-codegen -package workflowapi		-old-config-style -generate types,skip-prune							-o workflowapi/api.gen.go	-import-mapping llmproxy.yaml:github.com/ForestHubAI/edge-agents/go/api/llmapi		../../contract/workflow.yaml
//go:generate go tool oapi-codegen -package engineapi		-old-config-style -generate types,skip-prune							-o engineapi/api.gen.go		-import-mapping workflow.yaml:github.com/ForestHubAI/edge-agents/go/api/workflowapi,camera.yaml:github.com/ForestHubAI/edge-agents/go/api/cameraapi	../../contract/engine.yaml
//go:generate go tool oapi-codegen -package debugapi		-old-config-style -generate types,skip-prune							-o debugapi/api.gen.go		-import-mapping workflow.yaml:github.com/ForestHubAI/edge-agents/go/api/workflowapi	../../contract/debug.yaml
//go:generate go tool oapi-codegen -package deployapi		-old-config-style -generate types,skip-prune							-o deployapi/api.gen.go		-import-mapping workflow.yaml:github.com/ForestHubAI/edge-agents/go/api/workflowapi	../../contract/deployment.yaml
//go:generate go tool oapi-codegen -package mlapi			-old-config-style -generate types,skip-prune,client						-o mlapi/api.gen.go																								../../contract/ml.yaml
//go:generate go tool oapi-codegen -package cameraapi		-old-config-style -generate types,skip-prune,client,std-http-server		-o cameraapi/api.gen.go																							../../contract/camera.yaml
//go:generate go tool oapi-codegen -package mqttapi			-old-config-style -generate types,skip-prune							-o mqttapi/api.gen.go																							../../contract/mqtt.yaml
