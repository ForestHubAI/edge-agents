package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunSetup_RunsCommandsInOrder(t *testing.T) {
	out := filepath.Join(t.TempDir(), "log")
	file := camerasFile{Cameras: map[string]cameraConfig{
		"cam": {Source: sourceV4L2, Device: "/dev/video0", Setup: []string{
			"echo one >> " + out,
			"echo two >> " + out,
		}},
	}}
	require.NoError(t, runSetup(context.Background(), file))
	data, err := os.ReadFile(out)
	require.NoError(t, err)
	assert.Equal(t, "one\ntwo\n", string(data))
}

func TestRunSetup_VariablesCarryAcrossLines(t *testing.T) {
	out := filepath.Join(t.TempDir(), "log")
	file := camerasFile{Cameras: map[string]cameraConfig{
		"cam": {Source: sourceV4L2, Device: "/dev/video0", Setup: []string{
			"M=hello",
			"echo $M >> " + out,
		}},
	}}
	require.NoError(t, runSetup(context.Background(), file))
	data, err := os.ReadFile(out)
	require.NoError(t, err)
	assert.Equal(t, "hello\n", string(data))
}

func TestRunSetup_FailureNamesCameraAndShowsTrace(t *testing.T) {
	file := camerasFile{Cameras: map[string]cameraConfig{
		"cam": {Source: sourceV4L2, Device: "/dev/video0", Setup: []string{"echo broken >&2; exit 3"}},
	}}
	err := runSetup(context.Background(), file)
	require.Error(t, err)
	assert.Contains(t, err.Error(), `camera "cam"`)
	assert.Contains(t, err.Error(), "broken")
}

func TestRunSetup_StopsAtFirstFailingLine(t *testing.T) {
	out := filepath.Join(t.TempDir(), "log")
	file := camerasFile{Cameras: map[string]cameraConfig{
		"cam": {Source: sourceV4L2, Device: "/dev/video0", Setup: []string{
			"false",
			"echo reached >> " + out,
		}},
	}}
	require.Error(t, runSetup(context.Background(), file))
	assert.NoFileExists(t, out)
}

func TestRunSetup_NoCommandsIsNoop(t *testing.T) {
	file := camerasFile{Cameras: map[string]cameraConfig{
		"cam": {Source: sourceV4L2, Device: "/dev/video0"},
	}}
	assert.NoError(t, runSetup(context.Background(), file))
}
