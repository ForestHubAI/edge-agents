package expr

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageVal_Roundtrip(t *testing.T) {
	data := []byte{0xFF, 0xD8, 0xFF}
	v := ImageVal(data)

	assert.Equal(t, workflow.Image, v.Type)

	got, err := v.AsImage()
	require.NoError(t, err)
	assert.Equal(t, data, got)
}

func TestZeroValue_Image(t *testing.T) {
	assert.Equal(t, ImageVal(nil), ZeroValue(workflow.Image))
}

func TestAsImage_NonImage(t *testing.T) {
	_, err := StringVal("not an image").AsImage()
	assert.Error(t, err)
}

// image is opaque: it neither reads as another type nor is a valid Coerce target.
func TestImage_Opaque(t *testing.T) {
	img := ImageVal([]byte{0x01})

	assert.Empty(t, img.AsString())
	assert.Equal(t, StringVal(""), img.Cast(workflow.String))

	_, err := Coerce(workflow.Image, []byte{0x01})
	assert.Error(t, err)
}
