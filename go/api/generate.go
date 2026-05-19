package api

//go:generate go tool oapi-codegen -old-config-style -generate types,skip-prune 																						-o llmapi/types.gen.go -package llmapi ../../contract/llmproxy.yaml
//go:generate go tool oapi-codegen -old-config-style -generate types,skip-prune 																						-o workflow/types.gen.go -package workflow ../../contract/workflow.yaml
//go:generate go tool oapi-codegen -old-config-style -generate types,skip-prune       	-import-mapping workflow.yaml:github.com/ForestHubAI/fh-core/go/api/workflow	-o engineapi/types.gen.go  -package engineapi ../../contract/engine.yaml
//go:generate go tool oapi-codegen -old-config-style -generate chi-server,strict-server	-import-mapping workflow.yaml:github.com/ForestHubAI/fh-core/go/api/workflow 	-o engineapi/server.gen.go -package engineapi ../../contract/engine.yaml
//go:generate go tool oapi-codegen -old-config-style -generate types,skip-prune       	-import-mapping workflow.yaml:github.com/ForestHubAI/fh-core/go/api/workflow 	-o debugapi/types.gen.go   -package debugapi ../../contract/debug.yaml
