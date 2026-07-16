// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package camera

// Kind is the path a camera is reached by — not the sensor's form factor. Each
// kind maps to a capture recipe this component owns, so the manifest that
// declares a camera never has to spell one out. Mirrors the wire discriminator.
type Kind string

const (
	KindV4L2      Kind = "v4l2"      // a V4L2 device node (USB/UVC, or a set-up CSI/ISP node)
	KindLibcamera Kind = "libcamera" // the platform's libcamera stack
	KindRTSP      Kind = "rtsp"      // an IP camera over RTSP
	KindHTTP      Kind = "http"      // an MJPEG stream or still endpoint
	KindRaw       Kind = "raw"       // an escape-hatch source fragment, used verbatim
	KindDebug     Kind = "debug"     // a synthetic fixed frame, no hardware
)

// Config is the component's boot config in domain terms: the cameras it was
// issued, keyed by their device-manifest key — which is also the /capture name
// selector.
type Config struct {
	Cameras map[string]Camera
}

// Camera is one configured camera in domain terms. Kind selects the capture
// recipe; the other fields are kind-specific, the same shape the engine uses for
// LLM providers. Password never appears on the wire — it is merged in from the
// secret document at the api→domain boundary (see ToDomain).
type Camera struct {
	Kind         Kind
	Device       string   // v4l2: the device node
	CameraName   string   // libcamera: selects one sensor when several are present
	URL          string   // rtsp/http: the stream endpoint
	User         string   // rtsp/http: username, when the stream authenticates
	Password     string   // rtsp/http: from secrets, never from config
	Pipeline     string   // raw: the source fragment, used verbatim
	WarmupFrames int      // frames to discard before the returned one
	Setup        []string // v4l2/libcamera/raw: shell commands replayed at every start
}
