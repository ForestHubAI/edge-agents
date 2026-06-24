package build

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// vectorDB builds a workflow Memory wrapping a VectorDatabase with the given id.
func vectorDB(t *testing.T, id string) workflow.Memory {
	t.Helper()
	var m workflow.Memory
	require.NoError(t, m.FromVectorDatabase(workflow.VectorDatabase{
		Type:  workflow.VectorDatabaseTypeVectorDatabase,
		Id:    id,
		Label: id,
	}))
	return m
}

// memFile builds a workflow Memory wrapping a MemoryFile with the given id.
func memFile(t *testing.T, id string) workflow.Memory {
	t.Helper()
	var m workflow.Memory
	require.NoError(t, m.FromMemoryFile(workflow.MemoryFile{
		Type:        workflow.MemoryFileTypeMemoryFile,
		Id:          id,
		Label:       id,
		Content:     "x",
		Description: "d",
	}))
	return m
}

func TestBuildCollections_ResolvesVectorDatabase(t *testing.T) {
	wf := &workflow.Workflow{Memory: []workflow.Memory{vectorDB(t, "kb-1")}}
	dm := engine.DeploymentMapping{"kb-1": {Ref: "collection-abc"}}

	got, err := buildCollections(wf, dm)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"kb-1": "collection-abc"}, got)
}

func TestBuildCollections_MissingBindingFails(t *testing.T) {
	wf := &workflow.Workflow{Memory: []workflow.Memory{vectorDB(t, "kb-1")}}

	_, err := buildCollections(wf, nil)
	require.Error(t, err)
}

func TestBuildCollections_SkipsMemoryFile(t *testing.T) {
	wf := &workflow.Workflow{Memory: []workflow.Memory{memFile(t, "f-1"), vectorDB(t, "kb-1")}}
	dm := engine.DeploymentMapping{"kb-1": {Ref: "collection-abc"}}

	got, err := buildCollections(wf, dm)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"kb-1": "collection-abc"}, got)
	_, hasFile := got["f-1"]
	assert.False(t, hasFile, "MemoryFile must not require a collection binding")
}

func TestDeclaredMemoryFiles_ExtractsOnlyMemoryFiles(t *testing.T) {
	wf := &workflow.Workflow{Memory: []workflow.Memory{memFile(t, "f-1"), vectorDB(t, "kb-1")}}

	got, err := declaredMemoryFiles(wf)
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, "f-1", got[0].Id)
}

func TestDeclaredMemoryFiles_EmptyWhenNoMemory(t *testing.T) {
	got, err := declaredMemoryFiles(&workflow.Workflow{})
	require.NoError(t, err)
	assert.Empty(t, got)
}
