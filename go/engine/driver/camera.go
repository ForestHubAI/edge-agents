package driver

import "fmt"

// CameraBackend names the capture implementation selected per camera in the
// device manifest.
type CameraBackend string

const (
	CameraBackendV4L2      CameraBackend = "v4l2"
	CameraBackendGStreamer CameraBackend = "gstreamer"
)

// OpenCamera opens the camera at device using the named backend. The concrete
// backends are Linux-only (V4L2 ioctls, GStreamer/libcamera); off Linux both
// resolve to an in-memory debug driver, so a camera workflow builds and boots on
// any host. An unknown backend is a manifest error.
func OpenCamera(backend CameraBackend, device string) (CameraDriver, error) {
	switch backend {
	case CameraBackendV4L2:
		return openV4L2(device)
	case CameraBackendGStreamer:
		return openGStreamer(device)
	default:
		return nil, fmt.Errorf("camera: unknown backend %q", backend)
	}
}
